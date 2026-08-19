const Chunk = require('../../models/Chunk');
const WhatsAppMessage = require('../../models/WhatsAppMessage');
const { embedText } = require('../embeddings/openai.service');
const { insertChunks, searchChunks } = require('../vectorstore/atlas.service');
const { decrypt } = require('../../utils/crypto');

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
    },
    required: ['chunkId', 'text'],
  },
};

const WHATSAPP_CHAT_CONTEXT_TOOL = {
  name: 'get_whatsapp_chat_context',
  description:
    'Fetch a bounded window of older messages from this same WhatsApp chat. Use when a potentially useful message refers to earlier discussion, an unclear decision, people, dates, or pronouns that need context. This tool is only available while ingesting a WhatsApp message.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: 'How many older messages to fetch, from 1 to 20. Use enough to understand the discussion.' },
      beforeSentAt: { type: 'string', description: 'Optional ISO timestamp from a previous response. Use it to page farther back in the same chat.' },
    },
  },
};

function buildIngestTools(sourceType) {
  return sourceType === 'whatsapp'
    ? [SEARCH_MEMORY_TOOL, WHATSAPP_CHAT_CONTEXT_TOOL, SAVE_MEMORY_TOOL, EDIT_MEMORY_TOOL]
    : [SEARCH_MEMORY_TOOL, SAVE_MEMORY_TOOL, EDIT_MEMORY_TOOL];
}

function formatWhatsAppContextMessage(message) {
  if (!message.contentEncrypted) return null;
  try {
    const text = decrypt(message.contentEncrypted).trim();
    if (!text) return null;
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
      text,
    };
  } catch {
    return null;
  }
}

/**
 * Executes one tool call against real storage. `ctx` carries the scoping
 * info (org/project/personal + source metadata) so every write lands in the
 * right place regardless of whether it came from a file chunk or a WhatsApp
 * message — the caller doesn't need to know which.
 */
async function executeIngestTool(name, input, ctx) {
  const scope = ctx.projectId ? 'project' : 'personal';

  if (name === 'search_memory') {
    const queryEmbedding = await embedText(input.query);
    const results = await searchChunks({
      queryEmbedding,
      orgId: ctx.orgId,
      scope,
      projectId: ctx.projectId,
      ownerId: ctx.ownerId,
      topK: 5,
    });
    return { message: JSON.stringify(results.map((r) => ({ id: String(r._id), text: r.text }))) };
  }

  if (name === 'get_whatsapp_chat_context') {
    if (ctx.sourceType !== 'whatsapp' || !ctx.metadata?.integrationId || !ctx.metadata?.chatJid || !ctx.metadata?.messageTimestamp) {
      return { message: 'WhatsApp chat context is unavailable for this candidate.' };
    }

    const limit = Math.max(1, Math.min(Number(input.limit) || 12, 20));
    const hasCursor = Boolean(input.beforeSentAt);
    const beforeSentAt = hasCursor ? new Date(input.beforeSentAt) : new Date(ctx.metadata.messageTimestamp);
    if (Number.isNaN(beforeSentAt.getTime())) return { message: 'beforeSentAt must be a valid ISO timestamp.' };
    const messages = await WhatsAppMessage.find({
      integrationId: ctx.metadata.integrationId,
      chatJid: ctx.metadata.chatJid,
      _id: { $ne: ctx.metadata.sourceMessageId },
      sentAt: { [hasCursor ? '$lt' : '$lte']: beforeSentAt },
      contentEncrypted: { $ne: null },
    })
      .sort({ sentAt: -1 })
      .limit(limit)
      .select('messageId chatJid eventChatJid eventChatJidAlt chatName isGroup senderJid senderName senderPhoneNumber fromMe messageType quotedMessageId mentionedJids sentAt receivedAt contentEncrypted')
      .lean();
    const context = messages.reverse().map(formatWhatsAppContextMessage).filter(Boolean);
    return {
      message: context.length
        ? JSON.stringify({ messages: context, nextBeforeSentAt: context[0].sentAt })
        : 'No older readable messages were found in this chat.',
    };
  }

  if (name === 'save_memory') {
    const embedding = await embedText(input.text);
    const [doc] = await insertChunks([
      {
        sourceType: ctx.sourceType,
        fileId: ctx.fileId || null,
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        ownerId: ctx.ownerId,
        text: input.text,
        embedding,
        metadata: ctx.metadata,
      },
    ]);
    return { message: 'Saved.', action: 'saved', chunkId: String(doc._id) };
  }

  if (name === 'edit_memory') {
    const embedding = await embedText(input.text);
    const scopeFilter = ctx.projectId
      ? { projectId: ctx.projectId }
      : { projectId: null, ownerId: ctx.ownerId };
    const updated = await Chunk.findOneAndUpdate(
      { _id: input.chunkId, orgId: ctx.orgId, deletedAt: null, ...scopeFilter },
      { text: input.text, embedding }
    );
    if (!updated) return { message: 'That memory entry no longer exists.' };
    return { message: 'Updated.', action: 'edited', chunkId: input.chunkId };
  }

  return { message: `Unknown tool: ${name}` };
}

module.exports = { buildIngestTools, SEARCH_MEMORY_TOOL, executeIngestTool };
