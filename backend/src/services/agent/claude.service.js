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

function currentDateTimePrompt() {
  return `\n\nCurrent server date and time: ${new Date().toISOString()} (UTC). Use this to interpret relative dates such as today, tomorrow, and last week.`;
}

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
      system: `${SYSTEM_PROMPT}${currentDateTimePrompt()}`,
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
