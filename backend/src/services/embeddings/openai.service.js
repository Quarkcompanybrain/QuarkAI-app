const { openai } = require('../../config/openai');
const env = require('../../config/env');

async function embedTexts(texts) {
  const response = await openai.embeddings.create({
    model: env.openaiEmbeddingModel,
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

async function embedText(text) {
  const [vector] = await embedTexts([text]);
  return vector;
}

module.exports = { embedTexts, embedText };
