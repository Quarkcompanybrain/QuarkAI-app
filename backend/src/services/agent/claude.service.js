const { anthropic } = require('../../config/anthropic');
const env = require('../../config/env');
const { embedText } = require('../embeddings/openai.service');
const { searchChunks } = require('../vectorstore/atlas.service');

const SYSTEM_PROMPT = `You are Quark AI, a company-knowledge assistant. You have a get_knowledge tool that searches the user's stored knowledge base. Use it when answering the question genuinely benefits from company-specific facts, decisions, or details that might be stored — not for simple greetings, small talk, or things you can answer directly. You may call it more than once if the first search doesn't cover the question. When you use retrieved knowledge, answer using it and don't contradict it. If a search turns up nothing relevant, say so plainly instead of guessing.`;

const GET_KNOWLEDGE_TOOL = {
  name: 'get_knowledge',
  description:
    "Search the user's stored knowledge base (uploaded documents and WhatsApp-sourced knowledge) for information relevant to a query. Only call this when the question needs company-specific knowledge — skip it for greetings or general questions.",
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
  const messages = [...history];
  const collectedSources = [];

  for (let i = 0; i < 4; i++) {
    const stream = anthropic.messages.stream({
      model: env.anthropicChatModel,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [GET_KNOWLEDGE_TOOL],
      messages,
    });

    stream.on('text', (delta) => onToken(delta));

    const finalMessage = await stream.finalMessage();
    messages.push({ role: 'assistant', content: finalMessage.content });

    if (finalMessage.stop_reason !== 'tool_use') {
      const textBlock = finalMessage.content.find((block) => block.type === 'text');
      return { text: textBlock?.text || '', sources: collectedSources };
    }

    const toolResults = [];
    for (const block of finalMessage.content) {
      if (block.type !== 'tool_use' || block.name !== 'get_knowledge') continue;

      const queryEmbedding = await embedText(block.input.query);
      const results = await searchChunks({ queryEmbedding, orgId, scope, projectId, ownerId, topK: 8 });

      for (const r of results) collectedSources.push({ id: r._id, filename: r.metadata?.filename, score: r.score });

      const content = results.length
        ? results.map((r, idx) => `[${idx + 1}] (from ${r.metadata?.filename || 'a message'})\n${r.text}`).join('\n\n')
        : 'No relevant knowledge found.';

      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { text: '', sources: collectedSources };
}

/**
 * Short, cheap Haiku call to name a chat session from its first message —
 * mirrors what ChatGPT/Linear do so sessions are recognizable in a list
 * instead of all reading "New chat".
 */
async function generateChatTitle(firstMessage) {
  const response = await anthropic.messages.create({
    model: env.anthropicChunkModel,
    max_tokens: 20,
    system:
      'Generate a short title (3-6 words, no quotes, no trailing punctuation) summarizing what this chat message is asking about. Respond with ONLY the title.',
    messages: [{ role: 'user', content: firstMessage }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const title = textBlock?.text?.trim().replace(/^["']|["']$/g, '');
  return title && title.length > 0 ? title.slice(0, 80) : null;
}

module.exports = { streamAnswer, generateChatTitle };
