export function Logo({ withWordmark = true }: { withWordmark?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/logo-placeholder.svg" alt="Quark AI" className="h-7 w-7" />
      {withWordmark && <span className="font-display text-lg font-semibold tracking-tight text-ink">Quark AI</span>}
    </div>
  );
}
