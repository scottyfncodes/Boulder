import { useEffect } from 'react';
import type { Profile } from '../state/progress';
import { ROUTES } from '../content/routes';
import './title.css';

/**
 * The front door.
 *
 * One hero, one wordmark, one button. The three-step strip underneath is the
 * entire manual, because the entire game is one gesture repeated.
 */
export function Title({
  profile, onStart, onStandings,
}: {
  profile: Profile;
  onStart: () => void;
  onStandings: () => void;
}) {
  const returning = profile.totalSends > 0 || profile.totalFalls > 0;
  const sent = Object.values(profile.records).filter((r) => r.sent).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStart(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStart]);

  return (
    <div className="title">
      <div className="title__wall" aria-hidden="true" />
      <div className="title__glow" aria-hidden="true" />

      <div className="title__inner">
        <div className="title__hero">
          <img className="title__bernie" src="./icon-512.png" alt="" draggable={false} />
        </div>

        <div className="title__kicker">Fling · Stick · Send</div>
        <h1 className="title__mark">BOULDER</h1>
        <p className="title__tag">
          A bouldering game where you throw your limbs at the wall one at a time
          and the rest of you has to deal with it.
        </p>

        <button className="btn btn--primary title__go" onClick={onStart}>
          {returning ? 'Back to the wall' : 'Start climbing'}
        </button>

        {returning ? (
          <div className="title__stats" role="list">
            <div className="title__stat" role="listitem">
              <b>{profile.topGrade ?? '—'}</b><span>top grade</span>
            </div>
            <div className="title__stat" role="listitem">
              <b>{sent}<i>/{ROUTES.length}</i></b><span>routes sent</span>
            </div>
            <div className="title__stat" role="listitem">
              <b>{profile.points}</b><span>points</span>
            </div>
          </div>
        ) : (
          <div className="title__steps" aria-label="How it plays">
            <div className="title__step">
              <svg viewBox="0 0 40 40" aria-hidden="true">
                <circle cx="20" cy="20" r="9" fill="currentColor" opacity="0.18" />
                <circle cx="20" cy="20" r="5" fill="currentColor" />
              </svg>
              <b>Press</b><span>a hand or a foot</span>
            </div>
            <div className="title__step">
              <svg viewBox="0 0 40 40" aria-hidden="true">
                <path d="M20 8 v14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
                <path d="M12 16 L20 8 L28 16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <circle cx="20" cy="30" r="5" fill="currentColor" />
              </svg>
              <b>Pull</b><span>it back, like a slingshot</span>
            </div>
            <div className="title__step">
              <svg viewBox="0 0 40 40" aria-hidden="true">
                <path d="M8 30 Q20 4 32 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" strokeDasharray="2 5" />
                <circle cx="32" cy="12" r="5" fill="currentColor" />
              </svg>
              <b>Let go</b><span>and see what the body does</span>
            </div>
          </div>
        )}

        <div className="title__row">
          {returning && (
            <button className="btn btn--ghost title__link" onClick={onStandings}>Standings</button>
          )}
        </div>

        <p className="title__foot">
          No timers. No pump. Just physics, and a man in sunglasses who is not especially invested.
        </p>
      </div>
    </div>
  );
}
