import type { Hold, HoldType } from '../game/types';

/** Degrees are easier to set routes in than radians. */
export const deg = (d: number): number => (d * Math.PI) / 180;

/** Pull directions, named the way a setter would say them out loud. */
export const DOWN = deg(-90);
export const UP = deg(90);
export const LEFT = deg(180);
export const RIGHT = deg(0);
export const DOWN_LEFT = deg(215);
export const DOWN_RIGHT = deg(-35);
export const OUT_RIGHT = deg(15);
export const OUT_LEFT = deg(165);

type Opt = Partial<Pick<Hold, 'dir' | 'hard' | 'roll' | 'finish'>>;

function make(type: HoldType, size: number, defaultDir: number) {
  return (id: number, x: number, y: number, o: Opt = {}): Hold => ({
    id,
    pos: { x, y },
    type,
    size,
    dir: o.dir ?? defaultDir,
    ...(o.hard !== undefined ? { hard: o.hard } : {}),
    ...(o.roll !== undefined ? { roll: o.roll } : {}),
    ...(o.finish ? { finish: true } : {}),
  });
}

export const jug = make('jug', 0.115, DOWN);
export const crimp = make('crimp', 0.095, DOWN);
export const sloper = make('sloper', 0.115, DOWN);
export const pinch = make('pinch', 0.1, DOWN);
export const pocket = make('pocket', 0.105, DOWN);
export const sidepull = make('sidepull', 0.105, DOWN_LEFT);
export const undercling = make('undercling', 0.11, UP);
export const gaston = make('gaston', 0.105, OUT_RIGHT);
export const foot = make('foothold', 0.085, DOWN);
export const volume = make('volume', 0.15, DOWN);
