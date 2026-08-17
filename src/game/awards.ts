import type { Grade } from './types';
import { gradeIndex } from './types';

/**
 * Things you win by climbing, and then wear.
 *
 * None of it does anything. That is the point — the reward for sending a V6 is
 * that everyone can see you sent a V6, and the hat is how they see it.
 */

export type Slot = 'hat' | 'top' | 'legs';

export type Award = {
  id: string;
  name: string;
  slot: Slot;
  /** Deadpan line shown when it unlocks. */
  line: string;
  /** Rendered colour for the garment. */
  color: string;
  /** Hats only: the shape to build. */
  shape?: 'beanie' | 'cap' | 'bucket' | 'headband' | 'cowboy' | 'traffic-cone' | 'crown' | 'helmet';
  unlock: Unlock;
};

export type Unlock =
  | { kind: 'start' }
  | { kind: 'grade'; grade: Grade }
  | { kind: 'sends'; count: number }
  | { kind: 'falls'; count: number }
  | { kind: 'onsights'; count: number }
  | { kind: 'dynos'; count: number }
  | { kind: 'flash'; grade: Grade };

export const AWARDS: Award[] = [
  { id: 'tee-white', name: 'Gym T-shirt', slot: 'top', color: '#e6e2da', line: 'It was in the lost property box.', unlock: { kind: 'start' } },
  { id: 'shorts-navy', name: 'Ordinary shorts', slot: 'legs', color: '#4a5468', line: 'Perfectly adequate.', unlock: { kind: 'start' } },

  { id: 'headband', name: 'Sweatband', slot: 'hat', shape: 'headband', color: '#e8564f', line: 'For the sweat. There will be sweat.', unlock: { kind: 'sends', count: 3 } },
  { id: 'beanie', name: 'Indoor beanie', slot: 'hat', shape: 'beanie', color: '#5fb3a1', line: 'Worn indoors, in summer, on purpose.', unlock: { kind: 'grade', grade: 'V2' } },
  { id: 'cap', name: 'Backwards cap', slot: 'hat', shape: 'cap', color: '#3f7de0', line: 'The peak is behind you now. Like your projects.', unlock: { kind: 'grade', grade: 'V3' } },
  { id: 'bucket', name: 'Bucket hat', slot: 'hat', shape: 'bucket', color: '#7fa86b', line: 'Unimpeachable.', unlock: { kind: 'onsights', count: 3 } },
  { id: 'cone', name: 'Traffic cone', slot: 'hat', shape: 'traffic-cone', color: '#ff7a2f', line: 'You fell off enough times that the gym marked the spot.', unlock: { kind: 'falls', count: 40 } },
  { id: 'cowboy', name: 'Cowboy hat', slot: 'hat', shape: 'cowboy', color: '#b8862b', line: 'For the dynos. Yee, and I cannot stress this enough, haw.', unlock: { kind: 'dynos', count: 10 } },
  { id: 'helmet', name: 'Borrowed helmet', slot: 'hat', shape: 'helmet', color: '#f2c249', line: "Nobody wears one indoors. You're not nobody.", unlock: { kind: 'grade', grade: 'V5' } },
  { id: 'crown', name: 'Paper crown', slot: 'hat', shape: 'crown', color: '#ffd75e', line: 'Someone left it after a birthday party. It is yours now.', unlock: { kind: 'grade', grade: 'V8' } },

  { id: 'tee-stripe', name: 'Striped tee', slot: 'top', color: '#d96bff', line: 'Bold. Committed.', unlock: { kind: 'grade', grade: 'V1' } },
  { id: 'vest', name: 'Cut-off vest', slot: 'top', color: '#f2c249', line: 'The arms had to go.', unlock: { kind: 'grade', grade: 'V4' } },
  { id: 'flannel', name: 'Flannel shirt', slot: 'top', color: '#c0553f', line: 'Tied round the waist for the first four attempts.', unlock: { kind: 'sends', count: 15 } },
  { id: 'tee-gold', name: 'Gold tee', slot: 'top', color: '#b8862b', line: 'Tasteful. Arguably.', unlock: { kind: 'grade', grade: 'V10' } },

  { id: 'pants-baggy', name: 'Baggy pants', slot: 'legs', color: '#5a6478', line: 'Room to high step. Room for anything.', unlock: { kind: 'grade', grade: 'V2' } },
  { id: 'pants-loud', name: 'Loud leggings', slot: 'legs', color: '#2fe0c0', line: 'Visible from the café.', unlock: { kind: 'grade', grade: 'V6' } },
  { id: 'pants-denim', name: 'Denim cut-offs', slot: 'legs', color: '#4f6fa8', line: 'Questionable for climbing. Excellent for standing around.', unlock: { kind: 'falls', count: 15 } },
];

export type AwardProgress = {
  topGrade: Grade | null;
  sends: number;
  falls: number;
  onsights: number;
  dynos: number;
};

export function isUnlocked(award: Award, p: AwardProgress): boolean {
  const u = award.unlock;
  switch (u.kind) {
    case 'start': return true;
    case 'grade':
    case 'flash':
      return p.topGrade !== null && gradeIndex(p.topGrade) >= gradeIndex(u.grade);
    case 'sends': return p.sends >= u.count;
    case 'falls': return p.falls >= u.count;
    case 'onsights': return p.onsights >= u.count;
    case 'dynos': return p.dynos >= u.count;
  }
}

export function unlockedAwards(p: AwardProgress): Award[] {
  return AWARDS.filter((a) => isUnlocked(a, p));
}

export function awardById(id: string): Award | undefined {
  return AWARDS.find((a) => a.id === id);
}

/** What the player is wearing. */
export type Outfit = {
  hat: string | null;
  top: string;
  legs: string;
  skin: string;
};

export const SKIN_TONES = ['#e8b48c', '#c98d63', '#8d5a3b', '#5f3a25', '#f0c9a8', '#3d2417'];

export const DEFAULT_OUTFIT: Outfit = {
  hat: null,
  top: 'tee-white',
  legs: 'shorts-navy',
  skin: SKIN_TONES[0],
};

/** Describes what still needs doing to earn a locked item. */
export function requirement(award: Award): string {
  const u = award.unlock;
  switch (u.kind) {
    case 'start': return 'Yours already';
    case 'grade': return `Send a ${u.grade}`;
    case 'flash': return `Flash a ${u.grade}`;
    case 'sends': return `${u.count} sends`;
    case 'falls': return `${u.count} falls`;
    case 'onsights': return `${u.count} onsights`;
    case 'dynos': return `${u.count} dynos stuck`;
  }
}
