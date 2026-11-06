import { useCallback, useEffect, useRef, useState } from 'react';

export interface Page<T, C> {
  items: T[];
  hasMore: boolean;
  counts?: C;
}

/**
 * Loads a newest-first list one page at a time. `fetchPage(before, limit)`
 * gets the page after the item id `before` (null for the first page).
 * Changing `key` (filters, search) starts over; `reload()` re-fetches
 * everything loaded so far, e.g. to pick up status changes.
 */
export function usePagedList<T extends { id: string }, C>(
  fetchPage: (before: string | null, limit: number) => Promise<Page<T, C>>,
  key: string,
  pageSize = 30
) {
  const [items, setItems] = useState<T[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<C | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const loadedCount = useRef(0);

  const load = useCallback(
    async (limit: number) => {
      const id = ++request.current;
      try {
        const page = await fetchRef.current(null, limit);
        if (id !== request.current) return;
        setItems(page.items);
        setHasMore(page.hasMore);
        if (page.counts) setCounts(page.counts);
        loadedCount.current = page.items.length;
        setError(null);
      } catch (err) {
        if (id === request.current) setError(err instanceof Error ? err.message : 'Could not load this list.');
      }
    },
    []
  );

  useEffect(() => {
    setItems(null);
    setHasMore(false);
    void load(pageSize);
  }, [key, load, pageSize]);

  const loadMore = useCallback(async () => {
    if (!items?.length || loadingMore) return;
    const id = request.current;
    setLoadingMore(true);
    try {
      const page = await fetchRef.current(items[items.length - 1].id, pageSize);
      if (id !== request.current) return;
      setItems((current) => {
        const next = [...(current || []), ...page.items];
        loadedCount.current = next.length;
        return next;
      });
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more.');
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore, pageSize]);

  const reload = useCallback(() => load(Math.min(200, Math.max(pageSize, loadedCount.current))), [load, pageSize]);

  return { items, setItems, hasMore, counts, setCounts, loadMore, loadingMore, reload, error };
}

/** The value after the user stops typing for `delay` ms. */
export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
