import type { Route } from '../game/types';
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty } from '../content/generator';
import { setterOf } from '../content/setters';
import { GRADE_COLOR } from '../render/palette';
import { type Profile, recordFor } from '../state/progress';
import { RouteMap } from './RouteMap';
import './routesetter.css';

/**
 * The route setter's corner of the board. Pick how hard, get a route nobody
 * has climbed. Generated routes are checked by the same headless climber as
 * the board's, scored the same way, and never count toward your grade.
 */

export type SetterState = {
  difficulty: Difficulty;
  route: Route | null;
  busy: boolean;
  error: string | null;
};

const SECTION_LABEL: Record<string, string> = {
  slab: 'Slab', zigzag: 'Zigzag', traverse: 'Traverse', roof: 'Roof', overhang: 'Steep',
  dihedral: 'Corner', crack: 'Crack', arete: 'Arête', compression: 'Squeeze',
};

export function RouteSetter({
  state, profile, onPick, onReroll, onClimb,
}: {
  state: SetterState;
  profile: Profile;
  onPick: (d: Difficulty) => void;
  onReroll: () => void;
  onClimb: (route: Route) => void;
}) {
  const { route, busy, error, difficulty } = state;
  const rec = route ? recordFor(profile, route.id) : null;
  return (
    <section className="setter">
      <div className="setter__tag">Route setter</div>
      <div className="setter__levels" role="tablist" aria-label="Difficulty">
        {DIFFICULTIES.map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={d === difficulty}
            className={d === difficulty ? 'is-on' : ''}
            onClick={() => onPick(d)}
            disabled={busy && d !== difficulty}
          >
            {DIFFICULTY_LABEL[d]}
          </button>
        ))}
      </div>

      <div className={`setter__body${busy ? ' is-busy' : ''}`}>
        {route ? (
          <>
            <RouteMap route={route} className="setter__map" />
            <div className="setter__info">
              <div className="setter__name">
                <span className="chip" style={{ background: GRADE_COLOR[route.grade] }}>{route.grade}</span>
                {route.name}
              </div>
              <div className="setter__by">{setterOf(route.setter).name} — “{setterOf(route.setter).line}”</div>
              <div className="setter__tagline">{route.tagline}</div>
              {route.blueprint && route.blueprint.sections.length > 0 && (
                <div className="setter__parts">
                  {route.blueprint.sections.map((s, i) => (
                    <span key={i}>{SECTION_LABEL[s] ?? s}</span>
                  ))}
                  {route.blueprint.cruxes.length > 0 && (
                    <span className="is-crux">
                      {route.blueprint.cruxes.length === 1 ? 'Crux' : `${route.blueprint.cruxes.length} cruxes`}
                    </span>
                  )}
                </div>
              )}
              <div className="setter__meta">
                par {route.par}
                {route.overhang ? ` · ${route.overhang}° wall` : ''}
                {rec && rec.sent ? ` · sent in ${rec.best?.moves ?? '?'}` : rec && rec.attempts > 0 ? ` · ${rec.attempts} attempts` : ''}
              </div>
            </div>
          </>
        ) : (
          <div className="setter__empty">
            {error ? 'The setter got stuck on that one. Try again.' : busy ? 'Setting a route…' : 'Pick a difficulty.'}
          </div>
        )}
        {busy && route && <div className="setter__veil">Setting a route…</div>}
      </div>

      <div className="setter__actions">
        <button className="btn btn--primary" disabled={!route || busy} onClick={() => route && onClimb(route)}>
          Climb it
        </button>
        <button className="btn btn--ghost" disabled={busy} onClick={onReroll}>
          {busy ? 'Setting…' : 'Set another'}
        </button>
      </div>
      <div className="setter__note">
        Freshly set and test-climbed for you. Scored, never graded — only board routes move your grade.
      </div>
    </section>
  );
}
