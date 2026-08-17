import { useMemo, useState } from 'react';
import type { Route } from '../game/types';
import type { Attempt, Beta } from '../game/attempt';
import { betaDistance, toBeta } from '../game/attempt';
import { type ScoreCard, verdict } from '../game/scoring';
import { type CommunityBeta, communityBetasFor } from '../content/communityBeta';
import { GRADE_COLOR } from '../render/palette';
import './result.css';

/**
 * The send screen.
 *
 * Numbers first, then the sequence you used, then the uncomfortable news that
 * other people did it differently. The community beta is the hook — the moment
 * a player finds out there was a way they never considered is worth more to
 * this game than any unlock.
 */

export type ResultScreenProps = {
  route: Route;
  attempt: Attempt;
  card: ScoreCard;
  personalBest: ScoreCard | null;
  onAgain: () => void;
  onDone: () => void;
};

export function ResultScreen({ route, attempt, card, personalBest, onAgain, onDone }: ResultScreenProps) {
  const [tab, setTab] = useState<'score' | 'beta'>('score');
  const accent = GRADE_COLOR[route.grade];
  const beta = useMemo(() => toBeta(attempt.moves), [attempt]);
  const community = useMemo(() => communityBetasFor(route.id), [route.id]);

  // Which known sequence the player's line most resembles. There is no backend
  // yet, so these are lines the headless climber found rather than lines real
  // people took — the screen says so rather than inventing a population.
  const closest = useMemo(() => {
    if (community.length === 0) return null;
    let best = 0;
    let bestD = Infinity;
    community.forEach((c, i) => {
      const d = betaDistance(beta, c.beta);
      if (d < bestD) { best = i; bestD = d; }
    });
    return { index: best, distance: bestD };
  }, [beta, community]);

  const improved = personalBest !== null && card.efficiency > personalBest.efficiency;

  return (
    <div className="result" style={{ ['--accent' as string]: accent }}>
      <div className="result__sheet">
        <div className="result__head">
          <div className="result__sent">SENT</div>
          <h1 className="result__name">
            <span className="result__grade" style={{ background: accent }}>{route.grade}</span>
            {route.name}
          </h1>
          <p className="result__verdict">{verdict(card)}</p>
        </div>

        <div className="result__tabs">
          <button className={tab === 'score' ? 'is-on' : ''} onClick={() => setTab('score')}>Score</button>
          <button className={tab === 'beta' ? 'is-on' : ''} onClick={() => setTab('beta')}>Your beta</button>
        </div>

        {tab === 'score' ? (
          <>
            <div className="effring">
              <div className="effring__num">{Math.round(card.efficiency * 100)}</div>
              <div className="effring__cap">efficiency</div>
              <svg viewBox="0 0 120 120" className="effring__svg" aria-hidden="true">
                <circle cx="60" cy="60" r="52" className="effring__track" />
                <circle
                  cx="60" cy="60" r="52"
                  className="effring__bar"
                  style={{ strokeDasharray: `${card.efficiency * 326.7} 326.7` }}
                />
              </svg>
            </div>

            <dl className="stats">
              <Stat label="Moves" value={String(card.moves)} sub={`par ${card.par}`} />
              <Stat label="Falls" value={String(card.falls)} />
              <Stat label="Perfect" value={String(card.perfect)} sub={`of ${card.moves}`} />
              <Stat label="Time" value={formatTime(card.timeMs)} />
              <Stat label="Shifts" value={String(card.shifts)} sub="free" />
              <Stat label="Style" value={card.onsight ? 'Onsight' : 'Project'} />
              <Stat label="Points" value={String(card.points)} />
            </dl>

            {improved && <div className="result__pb">New personal best on this one.</div>}
          </>
        ) : (
          <BetaPanel beta={beta} community={community} closest={closest} />
        )}

        <div className="result__actions">
          <button className="btn btn--ghost" onClick={onAgain}>Climb it again</button>
          <button className="btn btn--primary" onClick={onDone}>Done</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stats__item">
      <dt className="label">{label}</dt>
      <dd>{value}{sub && <span className="stats__sub">{sub}</span>}</dd>
    </div>
  );
}

function BetaPanel({
  beta, community, closest,
}: {
  beta: Beta;
  community: CommunityBeta[];
  closest: { index: number; distance: number } | null;
}) {
  const [showing, setShowing] = useState<number | null>(null);
  const other = showing !== null ? community[showing] : null;
  const others = community.length - (closest && closest.distance < 0.3 ? 1 : 0);

  return (
    <div className="beta">
      <div className="beta__cols">
        <div className="beta__col">
          <div className="label">Your beta</div>
          <ol className="beta__list">
            {beta.map((m, i) => (
              <li key={i}><span className="beta__limb">{m.limb}</span> → {m.holdId}</li>
            ))}
          </ol>
        </div>
        {other && (
          <div className="beta__col">
            <div className="label">{other.name}</div>
            <ol className="beta__list beta__list--alt">
              {other.beta.map((m, i) => (
                <li key={i}><span className="beta__limb">{m.limb}</span> → {m.holdId}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {community.length > 0 && (
        <div className="beta__community">
          <p className="beta__stat">
            {closest && closest.distance < 0.3
              ? <>Your line is essentially <b>{community[closest.index].name}</b>.</>
              : <>Your line is not one of the sequences on file.</>}
            {' '}
            {others > 0 && <>{others} other{others === 1 ? '' : 's'} also go.</>}
          </p>
          <div className="beta__chips">
            {community.map((c, i) => (
              <button
                key={c.name}
                className={`beta__chip${showing === i ? ' is-on' : ''}`}
                onClick={() => setShowing(showing === i ? null : i)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <p className="beta__caveat">
            Sequences found by the gym's own route-checker. Real climbers' betas
            arrive when there are real climbers.
          </p>
        </div>
      )}
    </div>
  );
}

export function formatTime(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}
