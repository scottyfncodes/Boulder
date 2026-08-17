import type { Hold, LimbId } from '../game/types';
import { profileOf } from '../game/holds';
import './hold-inspector.css';

/**
 * What a hold is, when you tap it during inspection.
 *
 * It names the shape and says what it wants, and stops there. It does not say
 * whether you should use it, which hand goes on it, or what comes next — that
 * is the puzzle, and handing it over would be the same as solving the route
 * for the player.
 */

const USES: Record<string, string> = {
  hand: 'Hands',
  foot: 'Feet',
  both: 'Hands or feet',
};

/** Rough compass reading of the direction a hold wants to be loaded. */
function facing(dir: number): string {
  const d = ((dir * 180) / Math.PI + 360) % 360;
  if (d > 247 && d <= 292) return 'pull straight down';
  if (d > 67 && d <= 112) return 'pull up — hips above it';
  if (d > 157 && d <= 202) return 'pull left, across you';
  if (d <= 22 || d > 337) return 'pull right, away from you';
  if (d > 202 && d <= 247) return 'pull down and left';
  if (d > 292 && d <= 337) return 'pull down and right';
  if (d > 22 && d <= 67) return 'pull up and right';
  return 'pull up and left';
}

export function HoldInspector({ hold, onClose }: { hold: Hold; onClose: () => void }) {
  const p = profileOf(hold.type);
  return (
    <div className="holdinfo" role="dialog" aria-label={`${p.label} details`}>
      <button className="holdinfo__close" onClick={onClose} aria-label="Close">×</button>
      <div className="holdinfo__type">{p.label}</div>
      <div className="holdinfo__note">{p.note}</div>
      <dl className="holdinfo__facts">
        <div><dt>Takes</dt><dd>{USES[p.affinity]}</dd></div>
        <div><dt>Wants</dt><dd>{p.push ? 'push away from you' : facing(hold.dir)}</dd></div>
        <div><dt>Size</dt><dd>{sizeWord(hold.size, p.zoneScale)}</dd></div>
      </dl>
    </div>
  );
}

function sizeWord(size: number, zoneScale: number): string {
  const r = size * zoneScale;
  if (r > 0.16) return 'huge';
  if (r > 0.11) return 'generous';
  if (r > 0.08) return 'fair';
  if (r > 0.06) return 'small';
  return 'barely there';
}

export type { LimbId };
