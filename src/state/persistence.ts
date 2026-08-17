import { type Profile, SAVE_VERSION, freshProfile } from './progress';

/**
 * Local save. One key, one JSON blob, version-guarded.
 *
 * Everything the game needs lives on the device for now. The shape is
 * deliberately serialisable and flat so that dropping a backend in later means
 * posting this object rather than reworking it.
 */

const KEY = 'boulder.profile.v1';
/** The game was called SEND before it was called Boulder. Saves outlive names. */
const LEGACY_KEYS = ['send.profile.v1'];

export function loadProfile(): Profile {
  if (typeof localStorage === 'undefined') return freshProfile();
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      for (const old of LEGACY_KEYS) {
        raw = localStorage.getItem(old);
        if (raw) break;
      }
    }
    if (!raw) return freshProfile();
    const parsed = JSON.parse(raw) as Partial<Profile>;
    if (parsed.version !== SAVE_VERSION) return freshProfile();
    return { ...freshProfile(), ...parsed } as Profile;
  } catch {
    // A corrupt save should cost the player their history, not the game.
    return freshProfile();
  }
}

export function saveProfile(profile: Profile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Private mode, quota, whatever. Play on.
  }
}

export function clearProfile(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
