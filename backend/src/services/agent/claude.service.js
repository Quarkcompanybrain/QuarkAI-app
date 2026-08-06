const { anthropic } = require('../../config/anthropic');
const env = require('../../config/env');

function buildSystemPrompt(retrievedChunks) {
  if (retrievedChunks.length === 0) {
    return 'You are Quark AI, a company-knowledge assistant. No relevant context was found for this question — say so plainly instead of guessing.';
  }

  const context = retrievedChunks
    .map((c, i) => `[${i + 1}] (from ${c.metadata?.filename || 'a file'})\n${c.text}`)
    .join('\n\n');

  return `You are Quark AI, a company-knowledge assistant. Answer the user's question using ONLY the context below. Cite sources inline using [1], [2], etc. matching the context blocks. If the context doesn't contain the answer, say so plainly instead of guessing.

Context:
${context}`;
}

/**
 * Streams a Claude response. onToken is called with each text delta;
 * resolves with the full accumulated text when done.
 */
async function streamAnswer({ history, retrievedChunks, onToken }) {
  const stream = anthropic.messages.stream({
    model: env.anthropicChatModel,
    max_tokens: 2048,
    system: buildSystemPrompt(retrievedChunks),
    messages: history,
  });

  stream.on('text', (delta) => onToken(delta));

  const finalMessage = await stream.finalMessage();
  const textBlock = finalMessage.content.find((block) => block.type === 'text');
  return textBlock?.text || '';
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
