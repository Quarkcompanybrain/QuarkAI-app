const mongoose = require('mongoose');
const Chunk = require('../../models/Chunk');
const env = require('../../config/env');

async function insertChunks(chunkDocs) {
  if (chunkDocs.length === 0) return [];
  return Chunk.insertMany(chunkDocs);
}

/**
 * Runs an Atlas Vector Search $vectorSearch query, scoped per the isolation
 * model: orgId always, then either projectId (project scope) or ownerId
 * (personal scope) — never both. Requires the VECTOR_SEARCH_INDEX Atlas
 * Search index (see docs/atlas-vector-index.json) with `vector` indexed
 * as the vector field and orgId/projectId/ownerId/deletedAt as filter fields.
 */
async function searchChunks({ queryEmbedding, orgId, scope, projectId, ownerId, topK = 8 }) {
  const filter = {
    orgId: new mongoose.Types.ObjectId(orgId),
    deletedAt: null,
    ...(scope === 'project'
      ? { projectId: new mongoose.Types.ObjectId(projectId) }
      : { projectId: null, ownerId: new mongoose.Types.ObjectId(ownerId) }),
  };

  return Chunk.aggregate([
    {
      $vectorSearch: {
        index: env.vectorIndexName,
        path: 'vector',
        queryVector: queryEmbedding,
        numCandidates: topK * 15,
        limit: topK,
        filter,
      },
    },
    {
      $project: {
        text: 1,
        metadata: 1,
        fileId: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]);
}

module.exports = { insertChunks, searchChunks };
