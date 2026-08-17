import { useMemo, useState } from 'react';
import {
  type Award, type Outfit, type Slot,
  AWARDS, SKIN_TONES, isUnlocked, requirement,
} from '../game/awards';
import { type Profile, onsightCount } from '../state/progress';
import './wardrobe.css';

/**
 * Build a climber, and wear what you have won.
 *
 * Everything locked is shown, greyed, with what it would take — a wardrobe you
 * cannot see the rest of is just a list of things you own.
 */

const SLOTS: { slot: Slot; label: string }[] = [
  { slot: 'hat', label: 'Head' },
  { slot: 'top', label: 'Top' },
  { slot: 'legs', label: 'Legs' },
];

export function Wardrobe({
  profile, onChange, onClose, title = 'Your climber',
}: {
  profile: Profile;
  onChange: (outfit: Outfit) => void;
  onClose: () => void;
  title?: string;
}) {
  const [slot, setSlot] = useState<Slot>('hat');
  const outfit = profile.outfit;

  const progress = useMemo(() => ({
    topGrade: profile.topGrade,
    sends: profile.totalSends,
    falls: profile.totalFalls,
    onsights: onsightCount(profile),
    dynos: profile.totalDynos,
  }), [profile]);

  const items = AWARDS.filter((a) => a.slot === slot);
  const unlockedCount = AWARDS.filter((a) => isUnlocked(a, progress)).length;

  const pick = (a: Award) => {
    if (!isUnlocked(a, progress)) return;
    if (a.slot === 'hat') {
      onChange({ ...outfit, hat: outfit.hat === a.id ? null : a.id });
    } else {
      onChange({ ...outfit, [a.slot]: a.id });
    }
  };

  return (
    <div className="wardrobe">
      <header className="wardrobe__head">
        <button className="wardrobe__back" onClick={onClose} aria-label="Done">←</button>
        <div>
          <h1>{title}</h1>
          <p className="wardrobe__count">{unlockedCount} of {AWARDS.length} unlocked</p>
        </div>
      </header>

      <section className="wardrobe__skin">
        <div className="label">Skin</div>
        <div className="wardrobe__tones">
          {SKIN_TONES.map((tone) => (
            <button
              key={tone}
              className={`tone${outfit.skin === tone ? ' is-on' : ''}`}
              style={{ background: tone }}
              aria-label={`Skin tone ${tone}`}
              onClick={() => onChange({ ...outfit, skin: tone })}
            />
          ))}
        </div>
      </section>

      <nav className="wardrobe__tabs">
        {SLOTS.map((t) => (
          <button
            key={t.slot}
            className={slot === t.slot ? 'is-on' : ''}
            onClick={() => setSlot(t.slot)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="wardrobe__grid">
        {slot === 'hat' && (
          <button
            className={`kit${outfit.hat === null ? ' is-on' : ''}`}
            onClick={() => onChange({ ...outfit, hat: null })}
          >
            <span className="kit__swatch kit__swatch--none">—</span>
            <span className="kit__name">No hat</span>
            <span className="kit__line">Bare head. Bold.</span>
          </button>
        )}
        {items.map((a) => {
          const open = isUnlocked(a, progress);
          const on = outfit[a.slot] === a.id;
          return (
            <button
              key={a.id}
              className={`kit${on ? ' is-on' : ''}${open ? '' : ' is-locked'}`}
              onClick={() => pick(a)}
              disabled={!open}
            >
              <span className="kit__swatch" style={{ background: a.color }} />
              <span className="kit__name">{a.name}</span>
              <span className="kit__line">{open ? a.line : requirement(a)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
