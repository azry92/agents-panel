/**
 * What each agent type wears, and how each accessory is drawn.
 *
 * Hats sit on the chameleon's crest (its sprite's `head` point); the glasses,
 * a side-view lens and arm, sit on its eye (its `eye` point).
 */

export type Accessory = 'none' | 'cap' | 'hardhat' | 'beret' | 'glasses' | 'gradcap' | 'magnifier'

/**
 * Which accessory an agent type wears. `type` is the subagent_type, e.g.
 * "Explore" or a plugin's "feature-dev:code-reviewer"; the first rule that
 * matches wins, so "ui-builder" builds (hard hat) before it designs (beret).
 */
export function accessoryFor(type: string): Accessory {
  if (/explore|search|research/i.test(type)) return 'magnifier'
  if (/review|audit|check/i.test(type)) return 'glasses'
  if (/guide|teach|document/i.test(type)) return 'gradcap'
  if (/build|setup|fix/i.test(type)) return 'hardhat'
  if (/design|draw|ui/i.test(type)) return 'beret'
  if (/plan|construct|architect/i.test(type)) return 'cap'
  return 'none'
}

export type AccessoryArt = {
  /** Which sprite point it's placed on. */
  on: 'head' | 'eye'
  /** The point in these rows that lands on the sprite's `on` point. */
  at: [number, number]
  /** [x, y, keys]: a run of pixels starting at (x, y); '.' is transparent. */
  rows: [number, number, string][]
  colors: Record<string, string>
  /** A CSS class for its own motion (the magnifier sweeps). */
  cls?: string
}

export const ACCESSORIES: Record<Exclude<Accessory, 'none'>, AccessoryArt> = {
  cap: {
    on: 'head',
    at: [10, 4],
    rows: [[7, 2, 'cccccc'], [6, 3, 'cccccccc'], [6, 4, 'ccccccccvvv']],
    colors: { c: '#3E5C76', v: '#2E465B' },
  },
  hardhat: {
    on: 'head',
    at: [10, 4],
    rows: [[8, 1, 'yyyy'], [7, 2, 'yyrryy'], [6, 3, 'yyyyyyyy'], [5, 4, 'yyyyyyyyyy']],
    colors: { y: '#E2B33C', r: '#C4932A' },
  },
  beret: {
    on: 'head',
    at: [11, 4],
    rows: [[11, 0, 'n'], [8, 1, 'nnnnn'], [6, 2, 'nnnnnnnhn'], [5, 3, 'nnnnnnnnnnn'], [9, 4, 'nnnn']],
    colors: { n: '#B5485A', h: '#D06B7C' },
  },
  // Side view: one round frame over the eye ring, its arm running back along the head.
  glasses: {
    on: 'eye',
    at: [6, 2],
    rows: [[4, 0, '.ffff.'], [0, 1, 'ffff'], [4, 1, 'f....f'], [4, 2, 'f....f'], [4, 3, 'f....f'], [4, 4, 'f....f'], [4, 5, '.ffff.']],
    colors: { f: '#4B5263' },
  },
  gradcap: {
    on: 'head',
    at: [10, 3],
    rows: [[9, 0, 'gg'], [5, 1, 'gggggggggg'], [6, 2, 'hhhhhhhh'], [7, 3, 'gggggg'], [15, 2, 't'], [15, 3, 't'], [15, 4, 'tt']],
    colors: { g: '#4B5263', h: '#6A7387', t: '#E2B33C' },
  },
  // Held up to the eye: the lens rims the eye ring (the eye shows through,
  // with a glint), and the handle angles down and forward.
  magnifier: {
    on: 'eye',
    at: [6, 2],
    rows: [
      [4, 0, '.oooo.'], [4, 1, 'oi...o'], [4, 2, 'o....o'], [4, 3, 'o....o'], [4, 4, 'o....o'], [4, 5, '.oooo.'],
      [10, 5, 'h'], [11, 6, 'h'], [12, 7, 'h'],
    ],
    colors: { o: '#7C8394', i: '#E8F6FC', h: '#8A6642' },
    cls: 'sweep',
  },
}
