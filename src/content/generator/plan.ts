import type { Archetype, CruxKind, TierParams } from './difficulty';
import { LATERAL, RISING } from './difficulty';
import type { Rand } from './rand';

/**
 * The plan: which sections, in which order, and where the cruxes go.
 *
 * This is the part of setting that happens before anyone picks up a drill —
 * "start on the slab, traverse out right under the roof, pull the lip, then
 * one hard move to the jug". Easy routes get one idea. Hard routes get two or
 * three that have to be linked. Brutal routes get four or five, and the last
 * one is not the one you were worried about.
 */

export type PlanItem =
  | { kind: 'section'; archetype: Archetype }
  | { kind: 'crux'; crux: CruxKind; final: boolean };

export type Plan = {
  items: PlanItem[];
  sections: Archetype[];
  cruxes: CruxKind[];
};

export function makePlan(t: TierParams, r: Rand): Plan {
  const count = r.int(t.sections[0], t.sections[1]);
  const pool = t.pool.filter(([a]) => !t.forbid.includes(a));
  const chosen: Archetype[] = [];

  // Required combinations first, each from its own group, preferring
  // archetypes not already in the route so a combination is a combination.
  for (const group of t.require) {
    if (chosen.length >= count) break;
    if (group.some((a) => chosen.includes(a)) && group.length > 1) continue;
    const options = pool.filter(([a]) => group.includes(a) && !chosen.includes(a));
    if (options.length === 0) continue;
    chosen.push(r.weighted(options));
  }
  while (chosen.length < count) {
    // Repeats are allowed on the long routes — two traverses is a legitimate
    // route — but they are rarer than something new. A two-section route that
    // repeats itself is one section.
    const fresh = pool.filter(([a]) => !chosen.includes(a));
    const options = count <= 2 && fresh.length > 0
      ? fresh
      : pool.map(([a, w]) => [a, chosen.includes(a) ? w * 0.25 : w] as const);
    chosen.push(r.weighted(options));
  }

  const sections = order(chosen, t, r);

  // Cruxes: the last one sits late (that is the point of a crux — you are
  // nearly there), any earlier one somewhere in the middle third.
  let cruxCount = 0;
  for (let i = 0; i < t.cruxes[1]; i++) {
    if (i < t.cruxes[0] || r.chance(t.cruxChance)) cruxCount++;
  }
  const items: PlanItem[] = sections.map((archetype) => ({ kind: 'section', archetype }));
  const cruxes: CruxKind[] = [];
  const used = new Set<CruxKind>();
  for (let i = 0; i < cruxCount; i++) {
    const final = i === cruxCount - 1;
    const kinds = t.cruxKinds.filter(([k]) => !used.has(k));
    const crux = r.weighted(kinds.length ? kinds : t.cruxKinds);
    used.add(crux);
    cruxes.push(crux);
    const frac = final ? r.range(t.cruxAt[0], t.cruxAt[1]) : r.range(0.3, 0.5);
    // Never before the first section — a crux off the ground is a different
    // (and worse) kind of route — and never two cruxes without climbing between.
    const lastCrux = items.map((x) => x.kind).lastIndexOf('crux');
    const lo = Math.max(1, lastCrux + 2);
    const at = Math.max(lo, Math.min(items.length, Math.round(frac * items.length)));
    items.splice(Math.min(at, items.length), 0, { kind: 'crux', crux, final });
  }

  return { items, sections, cruxes };
}

/**
 * Orders sections so the route reads as a route: never two sideways sections
 * back to back (that is one long traverse wearing a disguise), and a roof
 * never opens the route if anything else could.
 */
function order(chosen: Archetype[], t: TierParams, r: Rand): Archetype[] {
  let best = chosen.slice();
  let bestScore = Infinity;
  for (let attempt = 0; attempt < 24; attempt++) {
    const cand = r.shuffle(chosen.slice());
    let score = 0;
    for (let i = 1; i < cand.length; i++) {
      if (LATERAL.has(cand[i]) && LATERAL.has(cand[i - 1])) score += 3;
      if (cand[i] === cand[i - 1]) score += 4;
    }
    if (cand[0] === 'roof' && cand.length > 1) score += 2;
    // Hard routes should top out by climbing, not by finishing a traverse.
    if (cand.length > 1 && LATERAL.has(cand[cand.length - 1]) && t.difficulty !== 'moderate') score += 1;
    if (score < bestScore) {
      bestScore = score;
      best = cand;
      if (score === 0) break;
    }
  }
  return best;
}

export function isRising(a: Archetype): boolean {
  return RISING.has(a);
}
