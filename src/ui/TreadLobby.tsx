import { TREAD_PROGRAMS, formatTime, levelGrade } from '../game/tread';
import { type Profile, treadBoard } from '../state/progress';
import { type ClimbMode, ModeTabs } from './ModeTabs';
import './modes.css';

/**
 * The tread wall's lobby: pick a program, see what you have to beat, go.
 * Each program is its own leaderboard — same angle, same belt, same rules.
 */
export function TreadLobby({
  profile, program, onProgram, onStart, onMode,
}: {
  profile: Profile;
  program: string;
  onProgram: (id: string) => void;
  onStart: () => void;
  onMode: (m: ClimbMode) => void;
}) {
  const board = treadBoard(profile, program);
  const best = profile.tread?.best[program];
  const recent = (profile.tread?.runs ?? []).filter((r) => r.program === program).slice(0, 3);
  return (
    <div className="modeboard">
      <header className="modeboard__head">
        <div>
          <div className="label">Tread Wall</div>
          <div className="modeboard__title" style={{ color: '#9b8cff' }}>{best ? formatTime(best.time) : '—'}</div>
        </div>
        <div className="label" style={{ textAlign: 'right' }}>{best ? 'personal best' : 'no runs yet'}</div>
      </header>
      <ModeTabs mode="tread" onMode={onMode} />
      <p className="modeboard__lede">
        A wall on a belt. It rolls down as you climb, so it never ends — the score is how long you
        stay on. The belt never stops, not even while you aim.
      </p>

      <div className="programs">
        {TREAD_PROGRAMS.map((p) => {
          const pb = profile.tread?.best[p.id];
          return (
            <button key={p.id} className={`program${p.id === program ? ' is-on' : ''}`} onClick={() => onProgram(p.id)}>
              <span className="program__angle">{p.angle}°</span>
              <span className="program__body">
                <div className="program__name">{p.name}</div>
                <div className="program__blurb">{p.blurb}</div>
              </span>
              <span className="program__pb">{pb ? <><b>{formatTime(pb.time)}</b>best</> : 'no run'}</span>
            </button>
          );
        })}
      </div>

      <button className="btn btn--primary treadgo" onClick={onStart}>Start a session</button>

      <div className="modeboard__section label">How to last</div>
      <ul className="rules">
        <li>Climb faster than the belt and you earn height; height is time to rest.</li>
        <li>You only recover where your feet carry you. Hanging off a jug on a steep panel is not a rest.</li>
        <li>Every few sections the wall gives you a jug ladder. Use it.</li>
        <li>Big throws and poor feet cost power and core; tired arms throw shorter.</li>
        <li>The session ends when you come off, pump off, or the floor reaches your hips.</li>
      </ul>

      <div className="modeboard__section label">Leaderboard · {TREAD_PROGRAMS.find((p) => p.id === program)?.name}</div>
      {board.length === 0 ? (
        <p className="modeboard__lede">No runs on this program yet.</p>
      ) : (
        <table className="lboard">
          <tbody>
            {board.map((r, i) => (
              <tr key={r.at} className={best && r.at === best.at ? 'is-best' : ''}>
                <td>{i + 1}</td>
                <td className="lboard__time">{formatTime(r.time)}</td>
                <td>{r.distance.toFixed(1)} m</td>
                <td>{r.moves} moves</td>
                <td>peak {levelGrade(r.peakLevel)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {recent.length > 0 && (
        <>
          <div className="modeboard__section label">Recent</div>
          <table className="lboard">
            <tbody>
              {recent.map((r) => (
                <tr key={`r${r.at}`}>
                  <td>·</td>
                  <td className="lboard__time">{formatTime(r.time)}</td>
                  <td colSpan={3}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
