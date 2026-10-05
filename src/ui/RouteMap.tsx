import type { Route } from '../game/types';
import { WALL } from '../content/wall';
import { angleAt, profileOf, routeTop } from '../game/profile';
import { GRADE_COLOR } from '../render/palette';

/**
 * A route as a setter's sketch: the wall, every hold on it, the start and the
 * finish. No line drawn between them — working out the line is the game.
 */
export function RouteMap({ route, className }: { route: Route; className?: string }) {
  const w = WALL.maxX - WALL.minX;
  const top = routeTop(route);
  const h = top - WALL.minY;
  // Steep bands shaded darker, so a roof reads on the map before you are under it.
  const profile = profileOf(route);
  const bands: { y0: number; y1: number; shade: number }[] = [];
  for (let y = WALL.minY; y < top; y += 0.1) {
    const shade = Math.min(1, Math.sin(angleAt(profile, y + 0.05)) / Math.sin(Math.PI / 2.4));
    if (shade > 0.35) bands.push({ y0: y, y1: y + 0.1, shade });
  }
  const starts = new Set(Object.values(route.start));
  const accent = GRADE_COLOR[route.grade];
  // SVG y runs down; the wall's runs up.
  const sx = (x: number) => x - WALL.minX;
  const sy = (y: number) => top - y;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Map of ${route.name}`}
    >
      <rect x={0} y={0} width={w} height={h} rx={0.12} className="routemap__wall" />
      {bands.map((b) => (
        <rect key={b.y0} x={0} y={sy(b.y1)} width={w} height={b.y1 - b.y0 + 0.002} fill="#000" opacity={0.28 * b.shade} />
      ))}
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
