const Sentry = require('@sentry/node');
const { randomUUID } = require('crypto');
const { openai } = require('../../config/openai');
const env = require('../../config/env');
const { buildIngestTools, executeIngestTool } = require('./tools');

const SYSTEM_PROMPT = `You maintain a permanent knowledge base. You're given one candidate piece of content — it might be a chunk of an uploaded document, a single chat message, or a chronological batch of WhatsApp messages. Decide what to do with it:

1. Call search_memory first to check whether related or contradicting information is already stored.
2. For a potentially useful WhatsApp message that depends on earlier discussion, call get_whatsapp_chat_context before deciding. Select focused query parameters (sender, direction, time range, type, reply, mention, text, or ingestion state) based on what you need to resolve. It only searches the same chat. Use it to resolve references, decisions, and updates; do not save a fragment that loses its meaning without that context.
3. If this is new information worth remembering (a fact, decision, update, instruction, or detail someone might later search for), call save_memory with a self-contained version of it — rephrase only as needed for it to make sense on its own, keeping the original wording and context as much as possible. For a WhatsApp batch, include the recordId of every supporting message in sourceMessageIds, and combine messages only when they establish one coherent fact.
4. If it updates or corrects something search_memory found, call edit_memory on that entry instead of creating a duplicate. For a WhatsApp batch, include the supporting recordIds in sourceMessageIds.
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
  if (metadata?.isBatch) return text;
  if (!metadata?.sourceMessageId) return text;

  const sentAt = metadata.messageTimestamp ? new Date(metadata.messageTimestamp).toISOString() : 'unknown';
  const sender = metadata.senderName || metadata.sender || (metadata.fromMe ? 'You' : 'Unknown sender');
  return `WhatsApp message context:\n- Sender: ${sender}${metadata.sender ? ` (${metadata.sender})` : ''}\n- Sent at: ${sentAt}\n- Chat: ${metadata.chatName || metadata.chatJid || 'Unknown chat'}\n\nMessage:\n${text}`;
}

function openAiTools(sourceType) {
  return buildIngestTools(sourceType).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

async function decideAndStore({ orgId, projectId, ownerId, sourceType, fileId, text, metadata, projectContext }) {
  const traceId = metadata?.traceId || randomUUID();
  const ctx = { orgId, projectId, ownerId, sourceType, fileId, metadata: { ...metadata, traceId } };
  const model = env.openaiIngestionModel;
  const maxTokens = metadata?.isBatch ? 2048 : 1024;
  const messages = [{ role: 'user', content: candidateContent(text, metadata) }];
  const system = `${SYSTEM_PROMPT}${currentDateTimePrompt()}${projectContextPrompt(projectContext)}`;
  let outcome = { action: 'skipped', actions: [] };
  Sentry.logger.info('AI memory ingestion started', { traceId, provider: 'openai', model, orgId, projectId, ownerId, sourceType, fileId, metadata: ctx.metadata, projectContext, system, initialMessages: messages });

  try {
    for (let i = 0; i < 5; i++) {
      Sentry.logger.info('AI memory ingestion model request', { traceId, provider: 'openai', model, iteration: i + 1, messages });
      const response = await openai.chat.completions.create({
        model,
        max_completion_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
        tools: openAiTools(sourceType),
      });
      const assistantMessage = response.choices[0]?.message;
      if (!assistantMessage) throw new Error('OpenAI returned no ingestion message.');
      Sentry.logger.info('AI memory ingestion model response', { traceId, provider: 'openai', model, iteration: i + 1, finishReason: response.choices[0]?.finish_reason, responseContent: assistantMessage, usage: response.usage });
      messages.push(assistantMessage);
      if (!assistantMessage.tool_calls?.length) break;

      const toolResults = [];
      for (const toolCall of assistantMessage.tool_calls) {
        let input;
        try {
          input = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          throw new Error(`OpenAI returned invalid JSON for ${toolCall.function.name}.`);
        }
        Sentry.logger.info('AI memory ingestion tool requested', { traceId, provider: 'openai', iteration: i + 1, tool: toolCall.function.name, input });
        const result = await executeIngestTool(toolCall.function.name, input, ctx);
        Sentry.logger.info('AI memory ingestion tool completed', { traceId, provider: 'openai', iteration: i + 1, tool: toolCall.function.name, input, result });
        if (result.action) {
          outcome = { action: result.action, chunkId: result.chunkId, actions: [...outcome.actions, result] };
        }
        toolResults.push({ role: 'tool', tool_call_id: toolCall.id, content: result.message });
      }
      messages.push(...toolResults);

      // Once it's actually saved or edited, no need to keep looping.
      if (outcome.action !== 'skipped' && !metadata?.isBatch) break;
    }
    Sentry.logger.info('AI memory ingestion completed', { traceId, provider: 'openai', model, outcome, finalMessages: messages });
    return outcome;
  } catch (err) {
    Sentry.captureException(err, { tags: { pipeline: 'memory_ingest' }, extra: { traceId, orgId, projectId, sourceType, fileId, metadata: ctx.metadata, messages } });
    throw err;
  }
}

module.exports = { decideAndStore };
