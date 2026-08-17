import type { Profile } from '../state/progress';
import './title.css';

/**
 * The front door. One button, one joke, no menu tree.
 */
export function Title({ profile, onStart }: { profile: Profile; onStart: () => void }) {
  const returning = profile.totalSends > 0 || profile.totalFalls > 0;
  return (
    <div className="title">
      <div className="title__inner">
        <div className="title__mark">SEND</div>
        <p className="title__tag">
          Read the route. Plan your beta. Throw your limbs at the wall.
          Somehow send it.
        </p>
        <button className="btn btn--primary title__go" onClick={onStart}>
          {returning ? 'Back to the wall' : 'Start climbing'}
        </button>
        {returning && (
          <div className="title__stats">
            {profile.topGrade ?? '—'} · {profile.totalSends} sends · {profile.totalFalls} falls
          </div>
        )}
        <p className="title__foot">
          Four limbs. One at a time. Nobody is going to tell you the sequence.
        </p>
      </div>
    </div>
  );
}
