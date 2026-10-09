import './modes.css';

/**
 * The three ways to climb, side by side at the top of every board. Each has
 * its own colour so you always know which wall you are looking at.
 */
export type ClimbMode = 'boulder' | 'highball' | 'tread';

export const MODE_COLOR: Record<ClimbMode, string> = {
  boulder: '#5fd1a0',
  highball: '#f2a13c',
  tread: '#9b8cff',
};

const MODES: { id: ClimbMode; name: string; sub: string }[] = [
  { id: 'boulder', name: 'Bouldering', sub: 'Read it, solve it' },
  { id: 'highball', name: 'Highball', sub: 'Tall, committing' },
  { id: 'tread', name: 'Tread Wall', sub: 'Stay on' },
];

export function ModeTabs({ mode, onMode }: { mode: ClimbMode; onMode: (m: ClimbMode) => void }) {
  return (
    <nav className="modes" aria-label="Climbing mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          className={`modes__tab${m.id === mode ? ' is-on' : ''}`}
          style={{ ['--mode' as string]: MODE_COLOR[m.id] }}
          onClick={() => onMode(m.id)}
          aria-pressed={m.id === mode}
        >
          <span className="modes__name">{m.name}</span>
          <span className="modes__sub">{m.sub}</span>
        </button>
      ))}
    </nav>
  );
}
