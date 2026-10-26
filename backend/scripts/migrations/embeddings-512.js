#!/usr/bin/env node
/**
 * Moves chunk embeddings from 1536-number arrays (`embedding`) to 512-dimension
 * BSON float32 vectors (`vector`), indexed by VECTOR_SEARCH_INDEX.
 *
 *   node scripts/migrations/embeddings-512.js [--dry-run]
 *     Step 1, safe before deploying: creates the new vector index and
 *     re-embeds every chunk that has no `vector` yet. Only adds a field; the
 *     old `embedding` field and index stay, so the running app keeps working.
 *
 *   node scripts/migrations/embeddings-512.js --finalize [--dry-run]
 *     Step 2, after the new code is deployed: re-embeds chunks the old code
 *     created in between, then removes the old `embedding` field and the old
 *     index. Refuses to run while any chunk still lacks a `vector`.
 *
 * Re-runnable. Uses MONGODB_URI from the environment or backend/.env.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const env = require('../../src/config/env');
const { connectDb, ensureVectorIndex } = require('../../src/config/db');
const { embedTexts, toStoredVector } = require('../../src/services/embeddings/openai.service');

const OLD_INDEX_NAME = 'chunk_vector_index';
const BATCH_SIZE = 100;
// text-embedding-3 accepts about 8k tokens per input.
const MAX_EMBED_CHARS = 24_000;

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const finalize = args.has('--finalize');

async function backfill(chunks) {
  const missing = { vector: { $exists: false } };
  console.log(`Chunks without a 512-dimension vector: ${await chunks.countDocuments(missing)}`);
  if (dryRun) return;

  let done = 0;
  let lastId = null;
  for (;;) {
    const batch = await chunks
      .find({ ...missing, ...(lastId ? { _id: { $gt: lastId } } : {}) }, { projection: { text: 1 } })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .toArray();
    if (!batch.length) break;
    lastId = batch[batch.length - 1]._id;

    const vectors = await embedTexts(batch.map((chunk) => (chunk.text || ' ').slice(0, MAX_EMBED_CHARS)), { operation: 'migration_embeddings_512' });
    await chunks.bulkWrite(batch.map((chunk, index) => ({
      updateOne: { filter: { _id: chunk._id, vector: { $exists: false } }, update: { $set: { vector: toStoredVector(vectors[index]) } } },
    })));
    done += batch.length;
    console.log(`  re-embedded ${done}`);
  }
}

async function removeLegacy(chunks) {
  const remaining = await chunks.countDocuments({ vector: { $exists: false } });
  if (remaining) throw new Error(`${remaining} chunks still have no vector; not removing the old embeddings.`);

  const [newIndex] = await chunks.listSearchIndexes(env.vectorIndexName).toArray();
  if (!newIndex?.queryable) throw new Error(`Vector index "${env.vectorIndexName}" isn't queryable yet (status: ${newIndex?.status || 'missing'}). Try again in a few minutes.`);

  const legacy = await chunks.countDocuments({ embedding: { $exists: true } });
  const oldIndexes = await chunks.listSearchIndexes(OLD_INDEX_NAME).toArray();
  console.log(`Chunks with the old embedding field: ${legacy}; old index present: ${oldIndexes.length > 0}`);
  if (dryRun) return;

  const result = await chunks.updateMany({ embedding: { $exists: true } }, { $unset: { embedding: '' } });
  console.log(`Removed the old embedding field from ${result.modifiedCount} chunks.`);
  if (oldIndexes.length) {
    await chunks.dropSearchIndex(OLD_INDEX_NAME);
    console.log(`Dropped the old vector index "${OLD_INDEX_NAME}".`);
  }
}

(async () => {
  await connectDb();
  const chunks = mongoose.connection.db.collection('chunks');
  console.log(`Database: ${mongoose.connection.db.databaseName}${dryRun ? ' (dry run)' : ''}`);
  if (!dryRun) await ensureVectorIndex();
  await backfill(chunks);
  if (finalize) await removeLegacy(chunks);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect();
  process.exit(1);
});
