/**
 * Route setters. Each one has a bias that shows up in what they set and a
 * line they say about it, which is almost never accurate.
 */

export type Setter = {
  id: string;
  name: string;
  /** Shown under the route name on the card. */
  line: string;
  /** Longer note on the setter, shown in the route list. */
  bio: string;
  accent: string;
};

export const SETTERS: Record<string, Setter> = {
  chad: {
    id: 'chad',
    name: 'Chad',
    line: "This one's pretty soft.",
    bio: 'Has never once graded a route correctly. Sets big moves off good holds and is baffled when people fall.',
    accent: '#e8b13d',
  },
  melissa: {
    id: 'melissa',
    name: 'Melissa',
    line: 'It goes. You have to want it.',
    bio: 'Technical to the point of cruelty. Every hold works, from exactly one position.',
    accent: '#5fb3d4',
  },
  dave: {
    id: 'dave',
    name: 'Dyno Dave',
    line: 'Just jump, man.',
    bio: 'Believes every problem is a jumping problem. Is correct more often than anyone would like.',
    accent: '#d9614c',
  },
  kevin: {
    id: 'kevin',
    name: 'Kevin',
    line: 'I found some new volumes.',
    bio: 'Uses fourteen volumes. Has been asked to stop. Has not stopped.',
    accent: '#7fa86b',
  },
  sadist: {
    id: 'sadist',
    name: 'The Sadist',
    line: 'Everything you need is on the wall.',
    bio: 'Technically fair. Emotionally unacceptable.',
    accent: '#9b6bd4',
  },
  house: {
    id: 'house',
    name: 'The Gym',
    line: 'Warm up properly.',
    bio: 'Set by whoever was on shift. Honest, unglamorous, does the job.',
    accent: '#8a8f9c',
  },
};

export function setterOf(id: string): Setter {
  return SETTERS[id] ?? SETTERS.house;
}
