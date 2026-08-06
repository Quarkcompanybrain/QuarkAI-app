import type { ReactNode } from 'react';
import { NeuralBackdrop } from './NeuralBackdrop';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl px-6 py-16 text-center">
      <NeuralBackdrop glow={false} />
      {icon && (
        <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-neutral-150 bg-white shadow-sm">
          {icon}
        </div>
      )}
      <h3 className="relative font-display text-base font-semibold text-ink">{title}</h3>
      {description && <p className="relative mt-1.5 max-w-sm text-sm text-neutral-500">{description}</p>}
      {action && <div className="relative mt-5">{action}</div>}
    </div>
  );
}
