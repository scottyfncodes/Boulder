import type { Route } from '../game/types';
import { WALL } from '../content/wall';
import { GRADE_COLOR } from '../render/palette';

/**
 * A route as a setter's sketch: the wall, every hold on it, the start and the
 * finish. No line drawn between them — working out the line is the game.
 */
export function RouteMap({ route, className }: { route: Route; className?: string }) {
  const w = WALL.maxX - WALL.minX;
  const h = WALL.maxY - WALL.minY;
  const starts = new Set(Object.values(route.start));
  const accent = GRADE_COLOR[route.grade];
  // SVG y runs down; the wall's runs up.
  const sx = (x: number) => x - WALL.minX;
  const sy = (y: number) => WALL.maxY - y;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Map of ${route.name}`}
    >
      <rect x={0} y={0} width={w} height={h} rx={0.12} className="routemap__wall" />
      {route.holds.map((hold) => {
        const foot = hold.type === 'foothold';
        const r = foot ? 0.045 : hold.type === 'volume' ? 0.1 : 0.068;
        return (
          <circle
            key={hold.id}
            cx={sx(hold.pos.x)}
            cy={sy(hold.pos.y)}
            r={r}
            fill={foot ? 'rgba(242,243,246,0.4)' : accent}
            stroke={hold.finish ? '#ffffff' : starts.has(hold.id) && !foot ? '#ffffff' : 'none'}
            strokeWidth={hold.finish ? 0.05 : 0.025}
            strokeDasharray={starts.has(hold.id) && !hold.finish ? '0.04 0.03' : undefined}
          />
        );
      })}
    </svg>
  );
}
