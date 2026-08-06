const Anthropic = require('@anthropic-ai/sdk');
const env = require('./env');

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

module.exports = { anthropic };
