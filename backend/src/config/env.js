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
  anthropicChatTitleModel: process.env.ANTHROPIC_CHAT_TITLE_MODEL || 'claude-haiku-4-5',
  anthropicReportModel: process.env.ANTHROPIC_REPORT_MODEL || process.env.ANTHROPIC_CHAT_MODEL || 'claude-sonnet-4-5',

  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  openaiIngestionModel: process.env.OPENAI_INGESTION_MODEL || 'gpt-5.4-nano',
  whatsappIngestionBatchWindowMs: Number(process.env.WHATSAPP_INGESTION_BATCH_WINDOW_MS) || 300_000,
  whatsappIngestionBatchMaxMessages: Number(process.env.WHATSAPP_INGESTION_BATCH_MAX_MESSAGES) || 30,
  whatsappIngestionBatchMaxChars: Number(process.env.WHATSAPP_INGESTION_BATCH_MAX_CHARS) || 12_000,
  emailSyncPollMs: Number(process.env.EMAIL_SYNC_POLL_MS) || 120_000,
  emailIngestionPollMs: Number(process.env.EMAIL_INGESTION_POLL_MS) || 15_000,
  whatsappIngestionBatchPollMs: Number(process.env.WHATSAPP_INGESTION_BATCH_POLL_MS) || 15_000,

  // Daily brief emailed to org admins. Sent once per org per local date, at or
  // after DAILY_REPORT_HOUR in DAILY_REPORT_TIMEZONE.
  dailyReportEnabled: process.env.DAILY_REPORT_ENABLED !== 'false',
  dailyReportHour: process.env.DAILY_REPORT_HOUR ? Number(process.env.DAILY_REPORT_HOUR) : 9,
  dailyReportTimezone: process.env.DAILY_REPORT_TIMEZONE || 'Asia/Kolkata',
  dailyReportPollMs: Number(process.env.DAILY_REPORT_POLL_MS) || 300_000,

  sentryDsn: process.env.SENTRY_DSN,

  integrationEncryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY,
};
