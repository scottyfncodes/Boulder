import { type TreadRun, formatTime, levelGrade, pace, programById } from '../game/tread';
import './modes.css';

/**
 * How the session went. Time on the wall first and biggest; then what it was
 * made of, set against the personal best, and the way straight back on.
 */
export function TreadResult({
  run, previous, isBest, onAgain, onDone,
}: { run: TreadRun; previous: TreadRun | null; isBest: boolean; onAgain: () => void; onDone: () => void }) {
  const p = programById(run.program);
  const diff = previous ? run.time - previous.time : 0;
  return (
    <div className="treadres">
      <div className="treadres__kicker">Tread Wall · {p.name} · {p.angle}°</div>
      <div className="treadres__time">{formatTime(run.time)}</div>
      <div className={`treadres__pb${isBest ? ' is-best' : ''}`}>
        {isBest
          ? previous ? `New personal best, by ${formatTime(diff)}` : 'First run: that is the one to beat'
          : `Personal best ${formatTime(previous!.time)} · ${formatTime(-diff)} short`}
      </div>
      <div className="treadres__why">{run.reason}</div>

      <div className="treadres__grid">
        <div className="treadres__stat"><b>{run.distance.toFixed(1)} m</b><span>climbed</span></div>
        <div className="treadres__stat"><b>{run.moves}</b><span>holds caught</span></div>
        <div className="treadres__stat"><b>{levelGrade(run.peakLevel)}</b><span>peak section</span></div>
        <div className="treadres__stat"><b>{pace(run).toFixed(1)}</b><span>moves / min</span></div>
        <div className="treadres__stat"><b>{run.rested}s</b><span>recovering</span></div>
        <div className="treadres__stat"><b>{Math.round(run.maxPump * 100)}%</b><span>peak pump</span></div>
      </div>
      {previous && !isBest && (
        <div className="treadres__compare">
          Best run: {previous.distance.toFixed(1)} m, {previous.moves} holds, peak {levelGrade(previous.peakLevel)}, {previous.rested}s recovering.
          {run.slips > previous.slips ? ` ${run.slips - previous.slips} more slips and misses this time.` : ''}
        </div>
      )}
      <div className="treadres__row">
        <button className="btn" onClick={onDone}>Lobby</button>
        <button className="btn btn--primary" onClick={onAgain} autoFocus>Go again</button>
      </div>
    </div>
  );
}
