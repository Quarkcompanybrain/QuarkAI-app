import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-neutral-150 bg-surface-gradient p-6 shadow-lg ${className}`}>
      {children}
    </div>
  );
}
