import { useMemo, useState } from 'react';
import type { Grade, Route } from '../game/types';
import { GRADES } from '../game/types';
import { ROUTES, routeById } from '../content/routes';
import { setterOf } from '../content/setters';
import { type Profile, isUnlocked, projectStatus, recordFor, onsightAvailable } from '../state/progress';
import { attemptsRemaining, type DailyState } from '../game/daily';
import { GRADE_COLOR } from '../render/palette';
import './routelist.css';

/**
 * The route board.
 *
 * Grades open one rung above whatever you have actually sent, so there is
 * always exactly one row of routes you have no business trying yet, clearly
 * visible, which is how a bouldering gym works.
 */

export type RouteListProps = {
  profile: Profile;
  daily: DailyState;
  onClimb: (route: Route, opts: { daily?: boolean }) => void;
  onToggleProject: (routeId: string) => void;
  onStandings: () => void;
  onWardrobe: () => void;
};

export function RouteList({
  profile, daily, onClimb, onToggleProject, onStandings, onWardrobe,
}: RouteListProps) {
  const [tab, setTab] = useState<'board' | 'projects'>('board');

  const byGrade = useMemo(() => {
    const map = new Map<Grade, Route[]>();
    for (const r of ROUTES) {
      const list = map.get(r.grade) ?? [];
      list.push(r);
      map.set(r.grade, list);
    }
    return map;
  }, []);

  const projects = ROUTES.filter((r) => recordFor(profile, r.id).project);
  const dailyRoute = routeById(daily.routeId);
  const left = attemptsRemaining(daily);

  return (
    <div className="board">
      <header className="board__head">
        <div>
          <div className="label">Your grade</div>
          <div className="board__grade">
            {profile.topGrade ?? '—'}
            <span className="board__gradenote">
              {profile.topGrade ? 'highest send' : 'nothing sent yet'}
            </span>
          </div>
        </div>
        <button className="board__tally" onClick={onStandings} aria-label="Standings">
          <div><b>{profile.totalSends}</b><span>sends</span></div>
          <div><b>{profile.points}</b><span>points</span></div>
          <div><b>{profile.totalFalls}</b><span>falls</span></div>
        </button>
      </header>

      {dailyRoute && (
        <button
          className="daily"
          disabled={left === 0 && !daily.sent}
          onClick={() => onClimb(dailyRoute, { daily: true })}
        >
          <div className="daily__tag">Daily climb</div>
          <div className="daily__name">
            <span className="chip" style={{ background: GRADE_COLOR[dailyRoute.grade] }}>
              {dailyRoute.grade}
            </span>
            {dailyRoute.name}
          </div>
          <div className="daily__meta">
            {daily.sent
              ? `Sent — ${daily.bestMoves} moves, ${Math.round((daily.bestEfficiency ?? 0) * 100)}% efficiency`
              : left > 0
                ? `${left} attempt${left === 1 ? '' : 's'} remaining${daily.onsightAvailable ? ' · onsight live' : ''}`
                : 'Out of attempts. Back tomorrow.'}
          </div>
        </button>
      )}

      <nav className="board__tabs">
        <button className={tab === 'board' ? 'is-on' : ''} onClick={() => setTab('board')}>
          Routes
        </button>
        <button className={tab === 'projects' ? 'is-on' : ''} onClick={() => setTab('projects')}>
          Projects{projects.length > 0 && <span className="pill">{projects.length}</span>}
        </button>
      </nav>

      {tab === 'projects' ? (
        <section className="board__list">
          {projects.length === 0 ? (
            <p className="board__empty">
              Nothing pinned. Star a route you keep falling off and it will wait for you here.
            </p>
          ) : (
            projects.map((r) => (
              <RouteCard
                key={r.id} route={r} profile={profile}
                onClimb={() => onClimb(r, {})}
                onToggleProject={() => onToggleProject(r.id)}
              />
            ))
          )}
        </section>
      ) : (
        GRADES.map((grade) => {
          const routes = byGrade.get(grade);
          if (!routes || routes.length === 0) return null;
          const open = isUnlocked(profile, grade);
          return (
            <section key={grade} className={`gradeblock${open ? '' : ' is-locked'}`}>
              <h2 className="gradeblock__head">
                <span className="chip" style={{ background: GRADE_COLOR[grade] }}>{grade}</span>
                <span className="gradeblock__count">
                  {open
                    ? `${routes.filter((r) => recordFor(profile, r.id).sent).length}/${routes.length} sent`
                    : `send a ${GRADES[GRADES.indexOf(grade) - 1]} to open`}
                </span>
              </h2>
              {open && (
                <div className="board__list">
                  {routes.map((r) => (
                    <RouteCard
                      key={r.id} route={r} profile={profile}
                      onClimb={() => onClimb(r, {})}
                      onToggleProject={() => onToggleProject(r.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}

      <button className="board__kit" onClick={onWardrobe}>
        Wardrobe &amp; climber
      </button>

      <footer className="board__foot">
        Read the route. Plan your beta. Throw your limbs at the wall.
      </footer>
    </div>
  );
}

function RouteCard({
  route, profile, onClimb, onToggleProject,
}: {
  route: Route;
  profile: Profile;
  onClimb: () => void;
  onToggleProject: () => void;
}) {
  const rec = recordFor(profile, route.id);
  const setter = setterOf(route.setter);
  const fresh = onsightAvailable(profile, route.id);

  return (
    <div className={`card${rec.sent ? ' is-sent' : ''}`}>
      <button className="card__main" onClick={onClimb}>
        <div className="card__top">
          <span className="card__name">{route.name}</span>
          {rec.onsighted && <span className="card__badge card__badge--onsight">ONSIGHT</span>}
          {rec.sent && !rec.onsighted && <span className="card__badge">SENT</span>}
          {fresh && <span className="card__badge card__badge--fresh">ONSIGHT LIVE</span>}
        </div>
        <div className="card__setter">{setter.name} — “{setter.line}”</div>
        <div className="card__meta">
          {rec.attempts === 0
            ? `par ${route.par}`
            : rec.sent
              ? `${rec.best?.moves ?? '?'} moves · ${Math.round((rec.best?.efficiency ?? 0) * 100)}% · ${rec.attempts} attempt${rec.attempts === 1 ? '' : 's'}`
              : `${projectStatus(rec, route.par)} · ${rec.attempts} attempt${rec.attempts === 1 ? '' : 's'} · best move ${rec.bestMove}`}
        </div>
      </button>
      <button
        className={`card__pin${rec.project ? ' is-on' : ''}`}
        onClick={onToggleProject}
        aria-label={rec.project ? 'Unpin project' : 'Pin as project'}
      >
        ★
      </button>
    </div>
  );
}
