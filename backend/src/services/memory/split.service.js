const Sentry = require('@sentry/node');
const { anthropic } = require('../../config/anthropic');
const { openai } = require('../../config/openai');
const env = require('../../config/env');

const SYSTEM_PROMPT = `You read a document and split it into semantically coherent chunks for a retrieval system.
Rules:
- Each chunk should be a self-contained unit of meaning (a section, a table's worth of rows, a complete idea) — not an arbitrary character count.
- Preserve important context (headers, labels) inside the chunk it belongs to so it makes sense in isolation.
- Skip pure boilerplate (page numbers, repeated headers/footers) but keep everything substantive.
- Respond with ONLY a JSON array of strings, one string per chunk. No prose, no markdown fences, no explanation.`;

function buildContentBlocks(handlerOutput, filename) {
  if (handlerOutput.kind === 'file') {
    const blockType = handlerOutput.mediaType.startsWith('image/') ? 'image' : 'document';
    return [
      {
        type: blockType,
        source: { type: 'base64', media_type: handlerOutput.mediaType, data: handlerOutput.base64 },
      },
      { type: 'text', text: `Split "${filename}" into semantic chunks per the system instructions.` },
    ];
  }

  return [
    {
      type: 'text',
      text: `Document "${filename}":\n\n${handlerOutput.text}\n\nSplit the document above into semantic chunks per the system instructions.`,
    },
  ];
}

function fallbackChunks(handlerOutput) {
  if (handlerOutput.kind !== 'text') return [];
  return handlerOutput.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function loggableContentBlocks(content) {
  return content.map((block) => {
    if (block.source?.data) {
      return { ...block, source: { ...block.source, data: `[base64 omitted; ${block.source.data.length} characters]` } };
    }
    return block;
  });
}

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

function loggableOpenAiContent(content) {
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

// Models routinely wrap JSON in ```json fences despite instructions not to — strip
// them before parsing, and fall back to grabbing the outermost [...] if that's not enough.
function parseChunkArray(rawText) {
  const stripped = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');

  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed) && parsed.every((c) => typeof c === 'string')) {
      return parsed.filter((c) => c.trim().length > 0);
    }
  } catch {
    // fall through
  }

  const firstBracket = stripped.indexOf('[');
  const lastBracket = stripped.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const parsed = JSON.parse(stripped.slice(firstBracket, lastBracket + 1));
      if (Array.isArray(parsed) && parsed.every((c) => typeof c === 'string')) {
        return parsed.filter((c) => c.trim().length > 0);
      }
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Breaks a document into candidate pieces for the ingestion decision step
 * (memory/ingest.service.js) to evaluate one at a time — this only splits,
 * it doesn't decide what's worth keeping (that's shared with WhatsApp
 * ingestion, which doesn't need splitting since a message already is one
 * candidate piece).
 */
async function splitFileIntoChunks(handlerOutput, filename, { traceId, useOpenAi = false, openAiModel } = {}) {
  const provider = useOpenAi ? 'openai' : 'anthropic';
  const model = useOpenAi ? (openAiModel || env.openaiFileIngestionModel) : env.anthropicChunkModel;
  const content = useOpenAi ? buildOpenAiContent(handlerOutput, filename) : buildContentBlocks(handlerOutput, filename);
  Sentry.logger.info('AI file chunking model request', {
    traceId,
    provider,
    model,
    filename,
    system: SYSTEM_PROMPT,
    content: useOpenAi ? loggableOpenAiContent(content) : loggableContentBlocks(content),
  });

  let rawText;
  let usage;
  if (useOpenAi) {
    const response = await openai.responses.create({
      model,
      instructions: SYSTEM_PROMPT,
      max_output_tokens: 8192,
      input: [{ role: 'user', content }],
    });
    rawText = response.output_text;
    usage = response.usage;
  } else {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });
    rawText = response.content.find((block) => block.type === 'text')?.text;
    usage = response.usage;
  }
  Sentry.logger.info('AI file chunking model response', { traceId, provider, model, filename, rawText, usage });
  if (!rawText) {
    const fallback = fallbackChunks(handlerOutput);
    Sentry.logger.info('AI file chunking used fallback without text response', { traceId, filename, chunks: fallback });
    return fallback;
  }

  const parsed = parseChunkArray(rawText);
  if (parsed) {
    Sentry.logger.info('AI file chunking parsed response', { traceId, filename, chunks: parsed });
    return parsed;
  }

  // Native formats (PDF/image) have no raw text to paragraph-split, so a parse
  // failure here is a real error, not "nothing to extract" — surface it as one.
  if (handlerOutput.kind === 'file') {
    throw new Error(`${useOpenAi ? 'GPT-5.4 nano' : 'Haiku'} returned unparseable chunk output for "${filename}".`);
  }

  const fallback = fallbackChunks(handlerOutput);
  Sentry.logger.info('AI file chunking used text fallback after parse failure', { traceId, filename, chunks: fallback });
  return fallback;
}

module.exports = { splitFileIntoChunks };
