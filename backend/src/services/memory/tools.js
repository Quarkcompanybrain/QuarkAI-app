const Chunk = require('../../models/Chunk');
const { embedText } = require('../embeddings/openai.service');
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

const INGEST_TOOLS = [SEARCH_MEMORY_TOOL, SAVE_MEMORY_TOOL, EDIT_MEMORY_TOOL];

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

module.exports = { INGEST_TOOLS, SEARCH_MEMORY_TOOL, executeIngestTool };
