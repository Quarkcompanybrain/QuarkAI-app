import type { ReactNode } from 'react';
import { SearchIcon, XIcon } from './icons';

export interface FilterChip<T extends string> {
  value: T | null;
  label: string;
  count?: number;
  icon?: ReactNode;
  /** Shown in magenta, e.g. failed items. */
  tone?: 'default' | 'alert';
}

/** Search box plus a row of single-select filter chips, used above long lists. */
export function ListToolbar<T extends string>({
  search,
  onSearch,
  placeholder,
  chips,
  active,
  onSelect,
  actions,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  chips: FilterChip<T>[];
  active: T | null;
  onSelect: (value: T | null) => void;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <SearchIcon className="pointer-events-none absolute left-3 h-4 w-4 text-neutral-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-8 text-sm text-ink outline-none transition-shadow placeholder:text-neutral-400 focus:border-magenta-500 focus:shadow-[0_0_0_3px_rgba(255,27,205,0.10)] [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button onClick={() => onSearch('')} aria-label="Clear search" className="absolute right-2 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-ink">
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        {actions}
      </div>
      {chips.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
          {chips.map((chip) => {
            const selected = chip.value === active;
            return (
              <button
                key={chip.value ?? 'all'}
                onClick={() => onSelect(chip.value)}
                aria-pressed={selected}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? 'border-ink bg-ink text-white'
                    : chip.tone === 'alert'
                      ? 'border-magenta-200 bg-magenta-50 text-magenta-600 hover:border-magenta-400'
                      : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-ink'
                }`}
              >
                {chip.icon}
                {chip.label}
                {chip.count !== undefined && <span className={selected ? 'text-white/70' : 'text-neutral-400'}>{chip.count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
