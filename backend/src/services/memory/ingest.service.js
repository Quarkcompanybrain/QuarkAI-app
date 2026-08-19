const { anthropic } = require('../../config/anthropic');
const env = require('../../config/env');
const { buildIngestTools, executeIngestTool } = require('./tools');

const SYSTEM_PROMPT = `You maintain a permanent knowledge base. You're given one candidate piece of content — it might be a chunk of an uploaded document or a single chat message. Decide what to do with it:

1. Call search_memory first to check whether related or contradicting information is already stored.
2. For a potentially useful WhatsApp message that depends on earlier discussion, call get_whatsapp_chat_context before deciding. It returns a bounded, private window of older messages from the same chat. Use it to resolve references, decisions, and updates; do not save a fragment that loses its meaning without that context.
3. If this is new information worth remembering (a fact, decision, update, instruction, or detail someone might later search for), call save_memory with a self-contained version of it — rephrase only as needed for it to make sense on its own, keeping the original wording and context as much as possible.
4. If it updates or corrects something search_memory found, call edit_memory on that entry instead of creating a duplicate.
5. If it has no lasting informational value (greetings, small talk, acknowledgements, emoji reactions, or something already fully captured), don't call save_memory or edit_memory at all — you're done.

Respond only with tool calls, no commentary.`;

/**
 * The single ingestion decision used everywhere content enters memory —
 * one file chunk, or one WhatsApp message. Same reasoning, same tools
 * (search/save/edit), so both sources dedupe and stay up to date against
 * each other identically.
 */
function projectContextPrompt(projectContext) {
  if (!projectContext?.name) return '';
  const description = projectContext.description?.trim();
  const websiteUrl = projectContext.websiteUrl?.trim();
  return `\n\nThis candidate is for the project "${projectContext.name}".${description ? ` Its purpose is: ${description}` : ''}${websiteUrl ? ` Its website is: ${websiteUrl}` : ''} Only save information that is genuinely relevant to this project’s purpose, work, people, product, customers, decisions, or website. Skip unrelated chat, personal discussion, and generic information even when it has lasting value elsewhere.`;
}

function currentDateTimePrompt() {
  return `\n\nCurrent server date and time: ${new Date().toISOString()} (UTC). Use this to interpret relative dates and times; do not treat it as content to save.`;
}

function candidateContent(text, metadata) {
  if (!metadata?.sourceMessageId) return text;

  const sentAt = metadata.messageTimestamp ? new Date(metadata.messageTimestamp).toISOString() : 'unknown';
  const sender = metadata.senderName || metadata.sender || (metadata.fromMe ? 'You' : 'Unknown sender');
  return `WhatsApp message context:\n- Sender: ${sender}${metadata.sender ? ` (${metadata.sender})` : ''}\n- Sent at: ${sentAt}\n- Chat: ${metadata.chatName || metadata.chatJid || 'Unknown chat'}\n\nMessage:\n${text}`;
}

async function decideAndStore({ orgId, projectId, ownerId, sourceType, fileId, text, metadata, projectContext }) {
  const ctx = { orgId, projectId, ownerId, sourceType, fileId, metadata };
  const messages = [{ role: 'user', content: candidateContent(text, metadata) }];
  let outcome = { action: 'skipped' };
  for (let i = 0; i < 5; i++) {
    const response = await anthropic.messages.create({
      model: env.anthropicChunkModel,
      max_tokens: 1024,
      system: `${SYSTEM_PROMPT}${currentDateTimePrompt()}${projectContextPrompt(projectContext)}`,
      tools: buildIngestTools(sourceType),
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
