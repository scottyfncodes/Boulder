import type { Grade } from '../game/types';
import { GRADE_COLOR } from '../render/palette';
import './breakthrough.css';

/**
 * The grade breakthrough.
 *
 * Not an unlock notification. The point is the sentence in the middle: you were
 * one kind of climber before this route and you are a different one now, and
 * the game says so flatly and then gets out of the way.
 */

const LINES: Partial<Record<Grade, string>> = {
  V0: 'One down. The wall is taller than it looks from the mat.',
  V1: 'The warmups are warmups now.',
  V2: 'You are reading sequences instead of guessing them.',
  V3: 'Your feet have started doing some of the work.',
  V4: 'Body position is a thing you think about before you move.',
  V5: 'You have opinions about beta. Loud ones.',
  V6: 'Most of the gym is now within reach. Most.',
  V7: 'You are the person other people ask about the sequence.',
  V8: 'There is not much left on this wall.',
  V9: 'Setters are starting to take it personally.',
  V10: 'Double digits. Your forearms have a group chat.',
  V11: 'The routes go sideways now. So does your social life.',
  V12: 'You have a favourite crimp. You have named it.',
  V13: 'The cave is wider than you remember. You remember all of it.',
  V14: 'People stop climbing to watch. Some of them are filming.',
  V15: 'There are maybe a dozen people who have done this. Hi.',
  V16: 'The setter did not think anyone would do that. Neither did you.',
  V17: 'Bruh.',
};

export type BreakthroughProps = {
  grade: Grade;
  previous: Grade | null;
  unlockedCount: number;
  onContinue: () => void;
};

export function Breakthrough({ grade, previous, unlockedCount, onContinue }: BreakthroughProps) {
  const color = GRADE_COLOR[grade];
  return (
    <div className="brk" style={{ ['--accent' as string]: color }}>
      <div className="brk__inner">
        <div className="brk__kicker">New grade</div>
        <div className="brk__grade" style={{ color }}>{grade}</div>
        <p className="brk__line">
          {previous
            ? `You are no longer a ${previous} climber.`
            : 'Your first send.'}
        </p>
        <p className="brk__sub">{LINES[grade] ?? 'That is a harder number than the last number.'}</p>
        {unlockedCount > 0 && (
          <div className="brk__unlocks">
            <span className="label">Now on the board</span>
            <span>{unlockedCount} new route{unlockedCount === 1 ? '' : 's'}</span>
          </div>
        )}
        <button className="btn btn--primary brk__go" onClick={onContinue}>Get on with it</button>
      </div>
    </div>
  );
}
