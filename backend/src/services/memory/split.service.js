const { anthropic } = require('../../config/anthropic');
const env = require('../../config/env');
const { ingestionDebug } = require('../../utils/ingestionDebug');

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
async function splitFileIntoChunks(handlerOutput, filename) {
  ingestionDebug('info', 'file split AI input', {
    filename,
    kind: handlerOutput.kind,
    mediaType: handlerOutput.mediaType || null,
    text: handlerOutput.kind === 'text' ? handlerOutput.text : null,
    binaryBytes: handlerOutput.kind === 'file' ? Buffer.byteLength(handlerOutput.base64, 'base64') : null,
  });
  const response = await anthropic.messages.create({
    model: env.anthropicChunkModel,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildContentBlocks(handlerOutput, filename) }],
  });
  ingestionDebug('info', 'file split AI output', { filename, stopReason: response.stop_reason, content: response.content });
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) return fallbackChunks(handlerOutput);

  const parsed = parseChunkArray(textBlock.text);
  if (parsed) return parsed;

  // Native formats (PDF/image) have no raw text to paragraph-split, so a parse
  // failure here is a real error, not "nothing to extract" — surface it as one.
  if (handlerOutput.kind === 'file') {
    throw new Error(`Haiku returned unparseable chunk output for "${filename}".`);
  }

  return fallbackChunks(handlerOutput);
}

module.exports = { splitFileIntoChunks };
