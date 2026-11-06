import { PulseNode } from './PulseNode';

/** "Showing 30 of 412" plus a Load more button, under a paged list. */
export function ListFooter({
  shown,
  total,
  hasMore,
  loading,
  onMore,
  noun,
}: {
  shown: number;
  /** Known total, or null when a search or filter is active. */
  total: number | null;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  noun: string;
}) {
  if (!hasMore && (total === null || total <= shown)) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-1 text-xs text-neutral-500">
      <span>
        Showing {shown}
        {total !== null ? ` of ${total}` : ''} {noun}
      </span>
      {hasMore && (
        <button
          onClick={onMore}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-ink shadow-xs transition-colors hover:border-neutral-300 disabled:opacity-60"
        >
          {loading && <PulseNode size={5} />}
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
