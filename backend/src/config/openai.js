const OpenAI = require('openai');
const env = require('./env');

const openai = new OpenAI({ apiKey: env.openaiApiKey });

module.exports = { openai };
