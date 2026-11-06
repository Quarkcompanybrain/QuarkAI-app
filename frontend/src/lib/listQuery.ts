/** Query string for the paged list endpoints (newest first, cut by id). */
export function listQuery(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** "Today", "Yesterday", or a date like "Mon, 3 Nov" (with the year when it isn't this year). */
export function dayLabel(date: Date, now = new Date()) {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function timeLabel(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Groups items (already sorted newest first) into consecutive day sections. */
export function groupByDay<T>(items: T[], dateOf: (item: T) => Date) {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(dateOf(item));
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
