const mongoose = require('mongoose');
const env = require('./env');

async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongodbUri);
  console.log('[db] connected to MongoDB');
}

/**
 * Creates the `chunks` Atlas Vector Search index if it doesn't exist yet.
 * Without it, $vectorSearch queries silently return zero matches instead of
 * erroring — chat retrieval looks "broken" with no error anywhere. Runs on
 * every boot; idempotent, so it's a no-op once the index is live. Requires
 * an Atlas cluster (M10+, or Atlas free/shared tiers that support Search).
 */
async function ensureVectorIndex() {
  const db = mongoose.connection.db;
  const collection = db.collection('chunks');

  let existing;
  try {
    existing = await collection.listSearchIndexes(env.vectorIndexName).toArray();
  } catch (err) {
    console.warn(`[db] Could not check vector search indexes (non-Atlas cluster?): ${err.message}`);
    return;
  }

  if (existing.length > 0) {
    const vectorField = existing[0].latestDefinition?.fields?.find((field) => field.type === 'vector');
    if (vectorField?.path !== 'vector' || vectorField?.numDimensions !== env.openaiEmbeddingDimensions) {
      // An index built for the old 1536-number `embedding` field matches nothing now.
      console.error(`[db] Vector search index "${env.vectorIndexName}" indexes ${vectorField?.path} with ${vectorField?.numDimensions} dimensions, not vector with ${env.openaiEmbeddingDimensions}. Chat and memory search will find nothing until VECTOR_SEARCH_INDEX names a matching index.`);
      return;
    }
    console.log(`[db] Vector search index "${env.vectorIndexName}" already exists (${existing[0].status}).`);
    return;
  }

  console.log(`[db] Creating vector search index "${env.vectorIndexName}"...`);
  await collection.createSearchIndex({
    name: env.vectorIndexName,
    type: 'vectorSearch',
    definition: {
      fields: [
        { type: 'vector', path: 'vector', numDimensions: env.openaiEmbeddingDimensions, similarity: 'cosine' },
        { type: 'filter', path: 'orgId' },
        { type: 'filter', path: 'projectId' },
        { type: 'filter', path: 'ownerId' },
        { type: 'filter', path: 'deletedAt' },
      ],
    },
  });
  console.log('[db] Vector search index creation requested — Atlas builds it in the background (a few minutes).');
}

module.exports = { connectDb, ensureVectorIndex };
