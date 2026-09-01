const Sentry = require('@sentry/node');
const { randomUUID } = require('crypto');
const { anthropic } = require('../../config/anthropic');
const env = require('../../config/env');
const { embedText } = require('../embeddings/openai.service');
const { searchChunks } = require('../vectorstore/atlas.service');

const SYSTEM_PROMPT = `You are Quark AI, a company-knowledge assistant. You have a get_knowledge tool that searches the user's stored knowledge base. Proactively use it for every substantive question unless it is clearly a simple greeting, small talk, or a purely general request with no possible connection to the user's organization, projects, files, decisions, or conversations. When in doubt, search first: the knowledge base may hold helpful context even if the question does not explicitly mention a file or project. You may call it more than once if the first search does not cover the question. When you use retrieved knowledge, ground the answer in it and do not contradict it. If a search turns up nothing relevant, say that no relevant stored knowledge was found, then provide a clearly-labelled general answer only when useful.`;

const GET_KNOWLEDGE_TOOL = {
  name: 'get_knowledge',
  description:
    "Search the user's stored knowledge base (uploaded documents and WhatsApp-sourced knowledge) for information relevant to a query. Use this proactively for substantive questions when stored context could help; skip only simple greetings, small talk, and clearly unrelated general questions.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A natural-language search query describing what information is needed.' },
    },
    required: ['query'],
  },
};

/**
 * Streams a Claude response, letting the model decide via the get_knowledge
 * tool whether retrieval is needed at all (e.g. "hi" never triggers a vector
 * search). Runs its own bounded agentic loop so chat.controller.js doesn't
 * need to know retrieval happened mid-stream — it only sees tokens and a
 * final `sources` list.
 */
async function streamAnswer({ history, orgId, scope, projectId, ownerId, onToken }) {
  const traceId = randomUUID();
  const messages = [...history];
  const collectedSources = [];
  const system = `${SYSTEM_PROMPT}\n\nCurrent server date and time: ${new Date().toISOString()} (UTC). Use this to interpret relative dates such as today, tomorrow, and last week.`;
  Sentry.logger.info('AI chat started', { traceId, orgId, scope, projectId, ownerId, system, history });

  try {
    for (let i = 0; i < 4; i++) {
      Sentry.logger.info('AI chat model request', { traceId, iteration: i + 1, messages });
      const stream = anthropic.messages.stream({
        model: env.anthropicChatModel,
        max_tokens: 2048,
        system,
        tools: [GET_KNOWLEDGE_TOOL],
        messages,
      });

      stream.on('text', (delta) => onToken(delta));

      const finalMessage = await stream.finalMessage();
      Sentry.logger.info('AI chat model response', { traceId, iteration: i + 1, stopReason: finalMessage.stop_reason, responseContent: finalMessage.content, usage: finalMessage.usage });
      messages.push({ role: 'assistant', content: finalMessage.content });

      if (finalMessage.stop_reason !== 'tool_use') {
        const textBlock = finalMessage.content.find((block) => block.type === 'text');
        const result = { text: textBlock?.text || '', sources: collectedSources };
        Sentry.logger.info('AI chat completed', { traceId, result, finalMessages: messages });
        return result;
      }

      const toolResults = [];
      for (const block of finalMessage.content) {
        if (block.type !== 'tool_use' || block.name !== 'get_knowledge') continue;
        Sentry.logger.info('AI chat knowledge retrieval started', { traceId, iteration: i + 1, input: block.input });

        const queryEmbedding = await embedText(block.input.query, { traceId, operation: 'chat_knowledge_retrieval' });
        const results = await searchChunks({ queryEmbedding, orgId, scope, projectId, ownerId, topK: 8 });

        for (const r of results) collectedSources.push({ id: r._id, filename: r.metadata?.filename, score: r.score });

        const content = results.length
          ? results.map((r, idx) => `[${idx + 1}] (from ${r.metadata?.filename || 'a message'})\n${r.text}`).join('\n\n')
          : 'No relevant knowledge found.';
        Sentry.logger.info('AI chat knowledge retrieval completed', { traceId, iteration: i + 1, input: block.input, results, toolResult: content });

        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
      }
      messages.push({ role: 'user', content: toolResults });
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { pipeline: 'chat_agent' }, extra: { traceId, orgId, scope, projectId, ownerId, messages, collectedSources } });
    throw err;
  }

  const result = { text: '', sources: collectedSources };
  Sentry.logger.info('AI chat stopped after iteration limit', { traceId, result, finalMessages: messages });
  return result;
}

/**
 * Short, cheap Haiku call to name a chat session from its first message —
 * mirrors what ChatGPT/Linear do so sessions are recognizable in a list
 * instead of all reading "New chat".
 */
async function generateChatTitle(firstMessage) {
  const traceId = randomUUID();
  Sentry.logger.info('AI chat title generation started', { traceId, firstMessage });
  const response = await anthropic.messages.create({
    model: env.anthropicChunkModel,
    max_tokens: 20,
    system:
      'Generate a short title (3-6 words, no quotes, no trailing punctuation) summarizing what this chat message is asking about. Respond with ONLY the title.',
    messages: [{ role: 'user', content: firstMessage }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const title = textBlock?.text?.trim().replace(/^["']|["']$/g, '');
  const result = title && title.length > 0 ? title.slice(0, 80) : null;
  Sentry.logger.info('AI chat title generation completed', { traceId, responseContent: response.content, usage: response.usage, result });
  return result;
}

module.exports = { streamAnswer, generateChatTitle };
