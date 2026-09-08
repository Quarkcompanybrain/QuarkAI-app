const Sentry = require('@sentry/node');
const { openai } = require('../../config/openai');
const env = require('../../config/env');

const SYSTEM_PROMPT = `You read a document and split it into semantically coherent chunks for a retrieval system.
Rules:
- Each chunk should be a self-contained unit of meaning (a section, a table's worth of rows, a complete idea) — not an arbitrary character count.
- Preserve important context (headers, labels) inside the chunk it belongs to so it makes sense in isolation.
- Skip pure boilerplate (page numbers, repeated headers/footers) but keep everything substantive.
- Respond with ONLY a JSON array of strings, one string per chunk. No prose, no markdown fences, no explanation.`;

function buildOpenAiContent(handlerOutput, filename) {
  const instruction = `Split "${filename}" into semantic chunks per the system instructions.`;
  if (handlerOutput.kind === 'file') {
    if (handlerOutput.mediaType.startsWith('image/')) {
      return [
        { type: 'input_text', text: instruction },
        { type: 'input_image', image_url: `data:${handlerOutput.mediaType};base64,${handlerOutput.base64}`, detail: 'auto' },
      ];
    }
    return [
      { type: 'input_text', text: instruction },
      {
        type: 'input_file',
        filename,
        file_data: `data:${handlerOutput.mediaType};base64,${handlerOutput.base64}`,
      },
    ];
  }

  return [{
    type: 'input_text',
    text: `Document "${filename}":\n\n${handlerOutput.text}\n\nSplit the document above into semantic chunks per the system instructions.`,
  }];
}

function loggableContent(content) {
  return content.map((block) => {
    if (block.image_url?.startsWith('data:')) {
      return { ...block, image_url: `[base64 image omitted; ${block.image_url.length} characters]` };
    }
    if (block.file_data?.startsWith('data:')) {
      return { ...block, file_data: `[base64 file omitted; ${block.file_data.length} characters]` };
    }
    return block;
  });
}

function parseChunkArray(rawText) {
  const stripped = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    const parsed = JSON.parse(stripped);
    return Array.isArray(parsed) && parsed.every((chunk) => typeof chunk === 'string')
      ? parsed.filter((chunk) => chunk.trim().length > 0)
      : null;
  } catch {
    return null;
  }
}

/**
 * Breaks a document into candidate pieces for the ingestion decision step
 * (memory/ingest.service.js) to evaluate one at a time — this only splits,
 * it doesn't decide what's worth keeping (that's shared with WhatsApp
 * ingestion, which doesn't need splitting since a message already is one
 * candidate piece).
 */
async function splitFileIntoChunks(handlerOutput, filename, { traceId } = {}) {
  const model = env.openaiIngestionModel;
  const content = buildOpenAiContent(handlerOutput, filename);
  Sentry.logger.info('AI file chunking model request', {
    traceId,
    provider: 'openai',
    model,
    filename,
    system: SYSTEM_PROMPT,
    content: loggableContent(content),
  });

  const response = await openai.responses.create({
    model,
    instructions: SYSTEM_PROMPT,
    max_output_tokens: 8192,
    input: [{ role: 'user', content }],
  });
  const rawText = response.output_text;
  Sentry.logger.info('AI file chunking model response', { traceId, provider: 'openai', model, filename, rawText, usage: response.usage });
  if (!rawText) throw new Error(`OpenAI returned no chunk output for "${filename}".`);

  const parsed = parseChunkArray(rawText);
  if (!parsed) throw new Error(`OpenAI returned unparseable chunk output for "${filename}".`);
  Sentry.logger.info('AI file chunking parsed response', { traceId, filename, chunks: parsed });
  return parsed;
}

module.exports = { splitFileIntoChunks };
