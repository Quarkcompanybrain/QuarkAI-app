const { anthropic } = require('../../config/anthropic');
const env = require('../../config/env');
const { INGEST_TOOLS, executeIngestTool } = require('./tools');

const SYSTEM_PROMPT = `You maintain a permanent knowledge base. You're given one candidate piece of content — it might be a chunk of an uploaded document or a single chat message. Decide what to do with it:

1. Call search_memory first to check whether related or contradicting information is already stored.
2. If this is new information worth remembering (a fact, decision, update, instruction, or detail someone might later search for), call save_memory with a self-contained version of it — rephrase only as needed for it to make sense on its own, keeping the original wording and context as much as possible.
3. If it updates or corrects something search_memory found, call edit_memory on that entry instead of creating a duplicate.
4. If it has no lasting informational value (greetings, small talk, acknowledgements, emoji reactions, or something already fully captured), don't call save_memory or edit_memory at all — you're done.

Respond only with tool calls, no commentary.`;

/**
 * The single ingestion decision used everywhere content enters memory —
 * one file chunk, or one WhatsApp message. Same reasoning, same tools
 * (search/save/edit), so both sources dedupe and stay up to date against
 * each other identically.
 */
async function decideAndStore({ orgId, projectId, ownerId, sourceType, fileId, text, metadata }) {
  const ctx = { orgId, projectId, ownerId, sourceType, fileId, metadata };
  const messages = [{ role: 'user', content: text }];
  let outcome = { action: 'skipped' };

  for (let i = 0; i < 3; i++) {
    const response = await anthropic.messages.create({
      model: env.anthropicChunkModel,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: INGEST_TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason !== 'tool_use') break;

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const result = await executeIngestTool(block.name, block.input, ctx);
      if (result.action) outcome = { action: result.action, chunkId: result.chunkId };
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.message });
    }
    messages.push({ role: 'user', content: toolResults });

    // Once it's actually saved or edited, no need to keep looping.
    if (outcome.action !== 'skipped') break;
  }

  return outcome;
}

module.exports = { decideAndStore };
