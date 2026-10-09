import type { Route } from '../game/types';
import { type Highball, highballs } from '../content/highball';
import { setterOf } from '../content/setters';
import { type Profile, recordFor } from '../state/progress';
import { GRADE_COLOR } from '../render/palette';
import { assessmentOf } from '../content/routeGrades';
import { type ClimbMode, ModeTabs } from './ModeTabs';
import './modes.css';

/**
 * The highball board. Tall problems, each its own kind of scary, with the
 * landing spelled out before you commit: how many pads, whether there is a
 * spotter, and how high the pads stop being enough.
 */
export function HighballList({
  profile, onClimb, onMode,
}: { profile: Profile; onClimb: (r: Route) => void; onMode: (m: ClimbMode) => void }) {
  const list = highballs();
  const sent = list.filter((h) => recordFor(profile, h.id).sent).length;
  return (
    <div className="modeboard">
      <header className="modeboard__head">
        <div>
          <div className="label">Highball</div>
          <div className="modeboard__title" style={{ color: '#f2a13c' }}>{sent}/{list.length}</div>
        </div>
        <div className="label" style={{ textAlign: 'right' }}>
          {profile.heavyLandings} heavy landing{profile.heavyLandings === 1 ? '' : 's'}
        </div>
      </header>
      <ModeTabs mode="highball" onMode={onMode} />
      <p className="modeboard__lede">
        Twice the height of a boulder problem, on the Tower. The climbing is the same climbing; the
        top is a long way off the ground, there are several hard parts, and the pads are only good
        for so much. Read the whole line before you pull on.
      </p>
      <div className="modeboard__list">
        {list.map((h) => <HighballCard key={h.id} h={h} profile={profile} onClimb={() => onClimb(h)} />)}
      </div>
    </div>
  );
}

function HighballCard({ h, profile, onClimb }: { h: Highball; profile: Profile; onClimb: () => void }) {
  const rec = recordFor(profile, h.id);
  const a = assessmentOf(h.id);
  const l = h.highball.landing;
  const best = rec.sent ? 1 : Math.min(1, rec.bestMove / Math.max(1, h.par));
  return (
    <button className={`hbcard${rec.sent ? ' is-sent' : ''}`} onClick={onClimb}>
      <div className="hbcard__top">
        <span className="chip" style={{ background: GRADE_COLOR[h.grade] }}>{h.grade}</span>
        <span className="hbcard__name">{h.name}</span>
        <span className="hbcard__height">{h.highball.height.toFixed(1)} m</span>
      </div>
      <div className="hbcard__char">{h.highball.character}</div>
      <div className="hbcard__meta">
        {setterOf(h.setter).name} · {l.pads} pad{l.pads > 1 ? 's' : ''}{l.spotter ? ' + spotter' : ', no spotter'}
        {a ? ` · ${a.styles.slice(0, 3).join(', ')}` : ''}
        {' · '}
        {rec.attempts === 0 ? 'untouched' : rec.sent ? `sent · ${rec.attempts} go${rec.attempts > 1 ? 'es' : ''}` : `${rec.attempts} go${rec.attempts > 1 ? 'es' : ''}, best ${rec.bestMove} moves`}
      </div>
      <div className="hbcard__bar"><i style={{ width: `${best * 100}%` }} /></div>
    </button>
  );
}
