/**
 * Switches for the slingshot pivot.
 *
 * The old game asked "can you climb before your pump runs out?". The new one
 * asks "can you figure out where to fling the next limb without screwing up
 * the entire body?". Both are still in the repository so they can be compared
 * by feel; these flags decide which one is live.
 */

/**
 * Whether the endurance pool drains at all. Off: the bar is gone, nothing
 * ticks, and taking your time costs nothing. The endurance module itself is
 * kept so the old loop can be brought back for comparison by flipping this.
 */
export const PUMP_ENABLED = false;

/** Which climbing loop the climb screen runs. */
export type ClimbMode = 'slingshot' | 'classic';

export const DEFAULT_CLIMB_MODE: ClimbMode = 'slingshot';

const MODE_KEY = 'boulder.climbMode';

export function loadClimbMode(): ClimbMode {
  try {
    const raw = globalThis.localStorage?.getItem(MODE_KEY);
    return raw === 'classic' || raw === 'slingshot' ? raw : DEFAULT_CLIMB_MODE;
  } catch {
    return DEFAULT_CLIMB_MODE;
  }
}

export function saveClimbMode(mode: ClimbMode): void {
  try {
    globalThis.localStorage?.setItem(MODE_KEY, mode);
  } catch {
    // Private mode, or no storage. The choice just does not stick.
  }
}
