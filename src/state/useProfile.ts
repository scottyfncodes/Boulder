import { useCallback, useEffect, useState } from 'react';
import { type Profile } from './progress';
import { loadProfile, saveProfile } from './persistence';

/** Profile state with write-through to local storage. */
export function useProfile() {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());

  useEffect(() => { saveProfile(profile); }, [profile]);

  const update = useCallback((fn: (p: Profile) => Profile) => {
    setProfile((p) => fn(p));
  }, []);

  return { profile, update, setProfile };
}
