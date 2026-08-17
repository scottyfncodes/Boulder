import { useMemo } from 'react';
import { ROUTES, routeById } from '../content/routes';
import type { Profile } from '../state/progress';
import { recordFor } from '../state/progress';
import { GRADE_COLOR } from '../render/palette';
import './standings.css';

/**
 * Standings.
 *
 * Every board here is built from the same per-route ScoreCards the send screen
 * writes, which is the shape a server would receive. Until there is a server
 * the only climber on it is you, and it says so rather than inventing rivals.
 */

type Board = {
  key: string;
  title: string;
  note: string;
  /** Lower is better for most of these. */
  rows: { routeId: string; label: string; value: string }[];
};

export function Standings({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const boards = useMemo<Board[]>(() => {
    const sent = ROUTES
      .map((r) => ({ route: r, rec: recordFor(profile, r.id) }))
      .filter((x) => x.rec.sent && x.rec.best);

    const byMoves = [...sent]
      .sort((a, b) => (a.rec.best!.moves - a.route.par) - (b.rec.best!.moves - b.route.par))
      .slice(0, 8);
    const byEff = [...sent]
      .sort((a, b) => b.rec.best!.efficiency - a.rec.best!.efficiency)
      .slice(0, 8);
    const byFalls = [...sent]
      .sort((a, b) => a.rec.attempts - b.rec.attempts)
      .slice(0, 8);
    const onsights = sent.filter((x) => x.rec.onsighted);

    return [
      {
        key: 'eff',
        title: 'Best efficiency',
        note: 'Movement quality against par, not speed.',
        rows: byEff.map((x) => ({
          routeId: x.route.id,
          label: x.route.name,
          value: `${Math.round(x.rec.best!.efficiency * 100)}%`,
        })),
      },
      {
        key: 'moves',
        title: 'Best moves',
        note: 'Measured against each route’s par.',
        rows: byMoves.map((x) => ({
          routeId: x.route.id,
          label: x.route.name,
          value: `${x.rec.best!.moves} / ${x.route.par}`,
        })),
      },
      {
        key: 'falls',
        title: 'Fewest attempts',
        note: 'How many goes it took to make it stick.',
        rows: byFalls.map((x) => ({
          routeId: x.route.id,
          label: x.route.name,
          value: `${x.rec.attempts}`,
        })),
      },
      {
        key: 'onsight',
        title: 'Onsights',
        note: 'First go, no falls, no prior knowledge.',
        rows: onsights.map((x) => ({
          routeId: x.route.id,
          label: x.route.name,
          value: x.route.grade,
        })),
      },
    ];
  }, [profile]);

  return (
    <div className="standings">
      <header className="standings__head">
        <button className="standings__back" onClick={onBack} aria-label="Back">←</button>
        <h1>Standings</h1>
      </header>

      <p className="standings__caveat">
        Local to this device. There is no server yet, so there is nobody to beat
        but the version of you that climbed it last time.
      </p>

      {boards.map((b) => (
        <section key={b.key} className="lb">
          <h2 className="lb__title">{b.title}</h2>
          <p className="lb__note">{b.note}</p>
          {b.rows.length === 0 ? (
            <p className="lb__empty">Nothing yet.</p>
          ) : (
            <ol className="lb__rows">
              {b.rows.map((row, i) => {
                const grade = routeById(row.routeId)?.grade;
                return (
                  <li key={row.routeId}>
                    <span className="lb__rank">{i + 1}</span>
                    {grade && (
                      <span className="lb__chip" style={{ background: GRADE_COLOR[grade] }}>
                        {grade}
                      </span>
                    )}
                    <span className="lb__label">{row.label}</span>
                    <span className="lb__value">{row.value}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}
