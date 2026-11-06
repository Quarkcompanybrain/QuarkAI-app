const { isValidObjectId, Types } = require('mongoose');

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 200;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Shared paging and search for long lists (newest first). Pages are cut by
 * _id: `before` is the last id of the previous page, so new rows arriving
 * between requests never shift or repeat entries.
 */
function parseListQuery(query) {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_PAGE_SIZE));
  const before = typeof query.before === 'string' && isValidObjectId(query.before) ? new Types.ObjectId(query.before) : null;
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 200) : '';
  return { limit, before, search: q ? new RegExp(escapeRegex(q), 'i') : null };
}

/** Fetches one page; `hasMore` comes from asking for one extra row. */
async function findPage(model, filter, { limit, before }) {
  const rows = await model
    .find(before ? { ...filter, _id: { $lt: before } } : filter)
    .sort({ _id: -1 })
    .limit(limit + 1);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

module.exports = { parseListQuery, findPage };
