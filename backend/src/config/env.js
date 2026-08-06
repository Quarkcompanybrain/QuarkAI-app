require('dotenv').config();

const required = ['MONGODB_URI', 'JWT_SECRET'];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[config] Missing env var ${key} — set it in .env before running real flows.`);
  }
}

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  mongodbUri: process.env.MONGODB_URI,
  vectorIndexName: process.env.VECTOR_INDEX_NAME || 'chunk_vector_index',

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  gmailUser: process.env.GMAIL_USER,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD,

  awsRegion: process.env.AWS_REGION,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  s3BucketName: process.env.S3_BUCKET_NAME,

  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicChatModel: process.env.ANTHROPIC_CHAT_MODEL || 'claude-sonnet-4-5',
  anthropicChunkModel: process.env.ANTHROPIC_CHUNK_MODEL || 'claude-haiku-4-5',

  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',

  sentryDsn: process.env.SENTRY_DSN,
};
