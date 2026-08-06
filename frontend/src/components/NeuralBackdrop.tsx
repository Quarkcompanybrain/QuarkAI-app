/**
 * The one signature visual motif, reused everywhere instead of scattered
 * decoration: a faint constellation of nodes + synapses (the "company brain").
 * The glow orbs are reserved for the auth screens where there's room to
 * breathe — inside the app (empty states, etc.) they read as a heavy pink
 * wash next to real content, so `glow={false}` keeps just the near-invisible
 * constellation there.
 */
const NODES = [
  [40, 60], [120, 30], [200, 90], [60, 160], [260, 50],
  [180, 180], [300, 140], [100, 220], [340, 70], [20, 130],
];

const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 4], [1, 5], [3, 0], [3, 7], [5, 6], [4, 8], [3, 9], [5, 7],
];

export function NeuralBackdrop({ className = '', glow = true }: { className?: string; glow?: boolean }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      {glow && (
        <>
          <div className="absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 animate-float-slow rounded-full bg-magenta-radial blur-2xl" />
          <div
            className="absolute bottom-0 right-0 h-[320px] w-[320px] animate-float-slow rounded-full bg-magenta-radial blur-2xl"
            style={{ animationDelay: '-4s' }}
          />
        </>
      )}
      <svg
        viewBox="0 0 360 260"
        className="absolute inset-0 h-full w-full opacity-[0.05]"
        preserveAspectRatio="xMidYMid slice"
      >
        {EDGES.map(([a, b], i) => (
          <line
            key={i}
            x1={NODES[a][0]}
            y1={NODES[a][1]}
            x2={NODES[b][0]}
            y2={NODES[b][1]}
            stroke="#0A0A0A"
            strokeWidth="1"
          />
        ))}
        {NODES.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 3 : 2} fill="#FF1BCD" />
        ))}
      </svg>
    </div>
  );
}
