const Sentry = require('@sentry/node');
const { Binary } = require('mongodb');
const { openai } = require('../../config/openai');
const env = require('../../config/env');
const { noteAiError } = require('../../utils/aiErrors');

async function embedTexts(texts, context = {}) {
  Sentry.logger.info('AI embedding request started', { ...context, model: env.openaiEmbeddingModel, texts });
  const response = await openai.embeddings.create({
    model: env.openaiEmbeddingModel,
    dimensions: env.openaiEmbeddingDimensions,
    input: texts,
  }).catch((err) => {
    noteAiError(err);
    throw err;
  });
  const vectors = response.data.map((d) => d.embedding);
  Sentry.logger.info('AI embedding request completed', { ...context, model: env.openaiEmbeddingModel, inputCount: texts.length, vectorDimensions: vectors.map((vector) => vector.length), usage: response.usage });
  return vectors;
}

async function embedText(text, context = {}) {
  const [vector] = await embedTexts([text], context);
  return vector;
}

/**
 * Packs an embedding as a BSON float32 vector (binary subtype 9): about a
 * quarter of the size of an array of doubles, with no loss, since the model's
 * values are float32 to begin with. Atlas Vector Search indexes it directly.
 */
function toStoredVector(embedding) {
  return Binary.fromFloat32Array(new Float32Array(embedding));
}

module.exports = { embedTexts, embedText, toStoredVector };
