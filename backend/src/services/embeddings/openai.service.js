const Sentry = require('@sentry/node');
const { openai } = require('../../config/openai');
const env = require('../../config/env');
const { noteAiError } = require('../../utils/aiErrors');

async function embedTexts(texts, context = {}) {
  Sentry.logger.info('AI embedding request started', { ...context, model: env.openaiEmbeddingModel, texts });
  const response = await openai.embeddings.create({
    model: env.openaiEmbeddingModel,
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

module.exports = { embedTexts, embedText };
