const Sentry = require('@sentry/node');
const Chunk = require('../../models/Chunk');
const WhatsAppMessage = require('../../models/WhatsAppMessage');
const { embedText, toStoredVector } = require('../embeddings/openai.service');
const { insertChunks, searchChunks } = require('../vectorstore/atlas.service');

// Shared by both the ingestion decision loop (memory/ingest.service.js) and
// chat retrieval (agent/claude.service.js) — one search implementation
// backing both "what do I already know" (ingestion) and "what do I need to
// answer this" (chat) tool calls.
const SEARCH_MEMORY_TOOL = {
  name: 'search_memory',
  description:
    "Search the stored knowledge base for information related to a query. Returns the closest matching entries, each with an id and its text.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A natural-language search query.' },
    },
    required: ['query'],
  },
};

const SAVE_MEMORY_TOOL = {
  name: 'save_memory',
  description:
    'Save a new, self-contained piece of knowledge to memory. Use for information worth remembering that isn\'t already captured — rephrase for clarity while keeping the original wording and context as much as possible.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The knowledge to remember, written so it makes sense on its own.' },
      sourceMessageIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'For a WhatsApp batch, the recordId values of every listed message that supports this memory. Omit for files or a single-message candidate.',
      },
    },
    required: ['text'],
  },
};

const EDIT_MEMORY_TOOL = {
  name: 'edit_memory',
  description:
    'Update an existing memory entry — use when new information supersedes or corrects something already stored (found via search_memory), instead of creating a duplicate.',
  input_schema: {
    type: 'object',
    properties: {
      chunkId: { type: 'string', description: 'The id of the existing memory entry to update (from search_memory).' },
      text: { type: 'string', description: 'The corrected/updated knowledge text.' },
      sourceMessageIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'For a WhatsApp batch, the recordId values of every listed message that supports this update. Omit for files or a single-message candidate.',
      },
    },
    required: ['chunkId', 'text'],
  },
};

const WHATSAPP_CHAT_CONTEXT_TOOL = {
  name: 'get_whatsapp_chat_context',
  description:
    'Query stored messages from this same WhatsApp chat. Choose only the filter parameters needed to resolve the current message: direction, sender, date range, message type, quoted message, mentions, text, or ingestion state. The integration and chat are always locked to the current message, so this tool cannot read another chat. Use focused queries first, then page farther back or broaden filters only when needed.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: 'Number of messages to return, from 1 to 50. Prefer a small focused result.' },
      beforeSentAt: { type: 'string', description: 'Optional ISO timestamp. Return messages before this point; use the previous response cursor to page backward.' },
      afterSentAt: { type: 'string', description: 'Optional ISO timestamp. Return messages at or after this point.' },
      direction: { type: 'string', enum: ['all', 'sent', 'received'], description: 'Filter by messages sent by the connected account, received from others, or both.' },
      senderJids: { type: 'array', items: { type: 'string' }, description: 'Optional exact sender JIDs to include, especially useful for group participants.' },
      senderNames: { type: 'array', items: { type: 'string' }, description: 'Optional sender names to match case-insensitively.' },
      messageTypes: { type: 'array', items: { type: 'string' }, description: 'Optional message types to include, such as text, extended_text, image, or document.' },
      quotedMessageId: { type: 'string', description: 'Optional WhatsApp message ID. Return replies to that message.' },
      mentionedJid: { type: 'string', description: 'Optional JID. Return messages that mention it.' },
      textSearch: { type: 'string', description: 'Optional words to search for in plaintext content; a message matches if it contains any of them. Prefer this for topical searches.' },
      textContains: { type: 'string', description: 'Optional literal text fragment to search in stored plaintext message content.' },
      hasIngestedMemory: { type: 'boolean', description: 'Optional filter for whether a message already produced memory.' },
      maxCharsPerMessage: { type: 'integer', description: 'Maximum content characters per result, from 200 to 4000. Increase only when exact wording matters.' },
    },
  },
};

function buildIngestTools(sourceType) {
  return sourceType === 'whatsapp'
    ? [SEARCH_MEMORY_TOOL, WHATSAPP_CHAT_CONTEXT_TOOL, SAVE_MEMORY_TOOL, EDIT_MEMORY_TOOL]
    : [SEARCH_MEMORY_TOOL, SAVE_MEMORY_TOOL, EDIT_MEMORY_TOOL];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTimestamp(value, fieldName) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${fieldName} must be a valid ISO timestamp.`);
  return date;
}

function formatWhatsAppContextMessage(message, maxCharsPerMessage) {
  const text = message.content?.trim() || null;
  const sender = message.senderName || message.senderJid || (message.fromMe ? 'You' : 'Unknown sender');
  return {
    recordId: String(message._id),
    messageId: message.messageId,
    sentAt: message.sentAt,
    receivedAt: message.receivedAt,
    sender,
    senderDetails: {
      jid: message.senderJid || null,
      name: message.senderName || null,
      phoneNumber: message.senderPhoneNumber || null,
      fromMe: message.fromMe,
    },
    chat: {
      jid: message.chatJid,
      name: message.chatName || null,
      isGroup: message.isGroup,
      eventJid: message.eventChatJid,
      eventJidAlt: message.eventChatJidAlt || null,
    },
    messageType: message.messageType,
    quotedMessageId: message.quotedMessageId || null,
    mentionedJids: message.mentionedJids || [],
    hasIngestedMemory: message.hasIngestedMemory,
    ingestionStatus: message.ingestionStatus,
    text: text && text.length > maxCharsPerMessage ? `${text.slice(0, maxCharsPerMessage)}…` : text,
  };
}

function sourceMessageIdsForTool(input, ctx) {
  const batchIds = (ctx.metadata?.batchMessageIds || []).map(String);
  if (batchIds.length === 0) return ctx.metadata?.sourceMessageId ? [String(ctx.metadata.sourceMessageId)] : [];

  const requested = Array.isArray(input.sourceMessageIds) ? input.sourceMessageIds.map(String) : [];
  const allowed = requested.filter((id) => batchIds.includes(id));
  if (allowed.length === 0) {
    throw new Error('A WhatsApp batch memory write must include one or more valid sourceMessageIds from the batch.');
  }
  return [...new Set(allowed)];
}

/**
 * Executes one tool call against real storage. `ctx` carries the scoping
 * info (org/project/personal + source metadata) so every write lands in the
 * right place regardless of whether it came from a file chunk or a WhatsApp
 * message — the caller doesn't need to know which.
 */
async function executeIngestTool(name, input, ctx) {
  const scope = ctx.projectId ? 'project' : 'personal';
  const traceId = ctx.metadata?.traceId;

  if (name === 'search_memory') {
    Sentry.logger.info('AI memory search started', { traceId, input, scope, orgId: ctx.orgId, projectId: ctx.projectId, ownerId: ctx.ownerId });
    const queryEmbedding = await embedText(input.query, { traceId, operation: 'memory_search' });
    const results = await searchChunks({
      queryEmbedding,
      orgId: ctx.orgId,
      scope,
      projectId: ctx.projectId,
      ownerId: ctx.ownerId,
      topK: 5,
    });
    const result = { message: JSON.stringify(results.map((r) => ({ id: String(r._id), text: r.text }))) };
    Sentry.logger.info('AI memory search completed', { traceId, input, resultCount: results.length, results, result });
    return result;
  }

  if (name === 'get_whatsapp_chat_context') {
    if (ctx.sourceType !== 'whatsapp' || !ctx.metadata?.integrationId || !ctx.metadata?.chatJid || !ctx.metadata?.messageTimestamp) {
      return { message: 'WhatsApp chat context is unavailable for this candidate.' };
    }

    const limit = Math.max(1, Math.min(Number(input.limit) || 12, 50));
    const maxCharsPerMessage = Math.max(200, Math.min(Number(input.maxCharsPerMessage) || 1500, 4000));
    const beforeSentAt = parseTimestamp(input.beforeSentAt, 'beforeSentAt') || new Date(ctx.metadata.messageTimestamp);
    const afterSentAt = parseTimestamp(input.afterSentAt, 'afterSentAt');
    const filter = {
      integrationId: ctx.metadata.integrationId,
      chatJid: ctx.metadata.chatJid,
      _id: ctx.metadata?.batchMessageIds?.length
        ? { $nin: ctx.metadata.batchMessageIds }
        : { $ne: ctx.metadata.sourceMessageId },
      content: { $type: 'string', $ne: '' },
      sentAt: { $lte: beforeSentAt },
    };
    if (afterSentAt) filter.sentAt.$gte = afterSentAt;
    if (input.direction === 'sent') filter.fromMe = true;
    if (input.direction === 'received') filter.fromMe = false;
    if (Array.isArray(input.senderJids) && input.senderJids.length) filter.senderJid = { $in: input.senderJids.slice(0, 20) };
    if (Array.isArray(input.senderNames) && input.senderNames.length) {
      filter.senderName = { $in: input.senderNames.slice(0, 10).map((name) => new RegExp(escapeRegex(String(name).slice(0, 120)), 'i')) };
    }
    if (Array.isArray(input.messageTypes) && input.messageTypes.length) filter.messageType = { $in: input.messageTypes.slice(0, 20) };
    if (input.quotedMessageId) filter.quotedMessageId = String(input.quotedMessageId).slice(0, 200);
    if (input.mentionedJid) filter.mentionedJids = String(input.mentionedJid).slice(0, 200);
    // Matched by regex within this one chat, which the indexed integration
    // and chat filters keep small, so content needs no text index.
    const contentFilters = [];
    const searchWords = [...new Set(String(input.textSearch || '').slice(0, 300).split(/\s+/).filter((word) => word.length >= 2))].slice(0, 8);
    if (searchWords.length) contentFilters.push({ content: { $regex: searchWords.map(escapeRegex).join('|'), $options: 'i' } });
    if (input.textContains) contentFilters.push({ content: { $regex: escapeRegex(String(input.textContains).slice(0, 200)), $options: 'i' } });
    if (contentFilters.length) filter.$and = contentFilters;
    if (typeof input.hasIngestedMemory === 'boolean') filter.hasIngestedMemory = input.hasIngestedMemory;

    Sentry.logger.info('AI WhatsApp context query started', { traceId, input, filter, limit, maxCharsPerMessage });
    const messages = await WhatsAppMessage.find(filter)
      .sort({ sentAt: -1 })
      .limit(limit)
      .select('messageId chatJid eventChatJid eventChatJidAlt chatName isGroup senderJid senderName senderPhoneNumber fromMe messageType quotedMessageId mentionedJids sentAt receivedAt content hasIngestedMemory ingestionStatus')
      .lean();
    const context = messages.reverse().map((message) => formatWhatsAppContextMessage(message, maxCharsPerMessage));
    const result = {
      message: context.length
        ? JSON.stringify({ messages: context, nextBeforeSentAt: context[0].sentAt, appliedFilters: input })
        : 'No matching readable messages were found in this chat.',
    };
    Sentry.logger.info('AI WhatsApp context query completed', { traceId, input, filter, matchedCount: context.length, context, result });
    return result;
  }

  if (name === 'save_memory') {
    Sentry.logger.info('AI memory save started', { traceId, input, sourceType: ctx.sourceType, orgId: ctx.orgId, projectId: ctx.projectId, fileId: ctx.fileId, metadata: ctx.metadata });
    const sourceMessageIds = sourceMessageIdsForTool(input, ctx);
    const vector = toStoredVector(await embedText(input.text, { traceId, operation: 'memory_save' }));
    const [doc] = await insertChunks([
      {
        sourceType: ctx.sourceType,
        fileId: ctx.fileId || null,
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        ownerId: ctx.ownerId,
        text: input.text,
        vector,
        metadata: {
          ...ctx.metadata,
          sourceMessageId: sourceMessageIds[0] || ctx.metadata?.sourceMessageId,
          sourceMessageIds: sourceMessageIds.length ? sourceMessageIds : undefined,
        },
      },
    ]);
    const result = { message: 'Saved.', action: 'saved', chunkId: String(doc._id), sourceMessageIds };
    Sentry.logger.info('AI memory save completed', { traceId, input, savedChunk: doc, result });
    return result;
  }

  if (name === 'edit_memory') {
    Sentry.logger.info('AI memory edit started', { traceId, input, orgId: ctx.orgId, projectId: ctx.projectId, ownerId: ctx.ownerId });
    const sourceMessageIds = sourceMessageIdsForTool(input, ctx);
    const vector = toStoredVector(await embedText(input.text, { traceId, operation: 'memory_edit' }));
    const scopeFilter = ctx.projectId
      ? { projectId: ctx.projectId }
      : { projectId: null, ownerId: ctx.ownerId };
    const updated = await Chunk.findOneAndUpdate(
      { _id: input.chunkId, orgId: ctx.orgId, deletedAt: null, ...scopeFilter },
      {
        $set: { text: input.text, vector },
        ...(sourceMessageIds.length ? { $addToSet: { 'metadata.sourceMessageIds': { $each: sourceMessageIds } } } : {}),
      }
    );
    if (!updated) {
      const result = { message: 'That memory entry no longer exists.' };
      Sentry.logger.info('AI memory edit skipped', { traceId, input, result });
      return result;
    }
    const result = { message: 'Updated.', action: 'edited', chunkId: input.chunkId, sourceMessageIds };
    Sentry.logger.info('AI memory edit completed', { traceId, input, updatedChunk: updated, result });
    return result;
  }

  return { message: `Unknown tool: ${name}` };
}

module.exports = { buildIngestTools, SEARCH_MEMORY_TOOL, executeIngestTool };
