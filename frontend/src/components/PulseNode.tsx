/**
 * Signature motif: a small magenta node that pulses whenever Quark AI is
 * "thinking" — streaming a chat reply or processing an upload. Reused
 * consistently instead of a generic spinner so the brand mark and the
 * product's own metaphor (a company brain) are the same shape.
 */
export function PulseNode({ size = 8, active = true }: { size?: number; active?: boolean }) {
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-magenta-400 opacity-40" />
      )}
      <span
        className={`relative inline-block rounded-full bg-magenta-gradient shadow-glow-sm ${active ? 'animate-pulse-node' : ''}`}
        style={{ width: size, height: size }}
      />
    </span>
  );
}
