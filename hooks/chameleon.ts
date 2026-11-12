/**
 * The agents-panel chameleon: one original pixel character, in three sizes,
 * whose colours are worked out at draw time rather than fixed.
 *
 * A sprite is a grid of single-character colour keys; '.' is transparent.
 *   o outline   b top   d underside   l highlight   p spikes   r eye ring
 *   w eye white   k pupil   n m branch (fixed colours)
 *
 * Every size shares one eye: a round 6x6 ring, a 4x4 white and a 2x2 pupil
 * with room to look left and right, so glasses and the eye's motion fit all three.
 */

export type Sprite = {
  /** Rows of equal length. Hatchling at most 14x11, young at most 20x16, adult at most 28x22 (w x h). */
  rows: string[]
  /** Where a hat sits: the top of the crest, in sprite coordinates [x, y]. */
  head: [number, number]
  /** The pupil's top-left pixel; the eye ring's corner is 2 up and 2 left of it. */
  eye: [number, number]
}

/** Hatchling, young, adult: the panel grows a chameleon as its agent uses tokens. */
export const STAGES: [Sprite, Sprite, Sprite] = [
  {
    rows: [
      '.......oooo...',
      '.....olbrrrrbo',
      '...p.olrwwwwro',
      '..poolbrwkkwro',
      '.olbbbbrwkkwro',
      '.obbbbbrwwwwro',
      'obbbbbbbrrrrbo',
      'oddddddddooooo',
      'oddoddooddo...',
      'nnnnddnnddnnnn',
      'mmmmdmmmdmmmmm',
    ],
    head: [8, 0],
    eye: [9, 3],
  },
  {
    rows: [
      '..........ooooo.....',
      '........oolbrrrrbo..',
      '......p.olbrwwwwrbo.',
      '....p.poolbrwkkwrbbo',
      '...poollbbbrwkkwrbbo',
      '..olbbbbbbbrwwwwrbbo',
      '.olbbbbbbbbbrrrrbbbo',
      '.obbbbbbbbbbbbbooooo',
      '.oddddddddddddddddo.',
      '.oddoddooodddoopopo.',
      '.oddoddo.odddo......',
      'nnnnddddnddddnnnnnnn',
      'mmmmdmmdmdmmdmmmmmmm',
      '.oddo.ooo......nn...',
      '.oddoodddo.......nn.',
      '.odddddooo..........',
    ],
    head: [12, 0],
    eye: [13, 3],
  },
  {
    rows: [
      '..................ooooo.....',
      '................oolllllo....',
      '...............olbbbbbbbo...',
      '...........p.polbbbbbbbbbo..',
      '.......p.poooollllbrrrrbbbo.',
      '.....poooollllbbbbrwwwwrbbbo',
      '...poollllbbbbbbbbrwkkwrbbbo',
      '...olbbbbbbbbbbbbbrwkkwrbbbo',
      '..olbbbbbbbbbbbbbbrwwwwrbbbo',
      '..obbbbbbbbbbbbbbbbrrrrbbbbo',
      '.obbbbbbbbbbbbbbbbbboooooooo',
      '.oddddddddddddddddddddddddo.',
      '.oddoodddooooddd' + 'oooooooooo' + '..',
      '.oddoodddo..odddo.p.p.p.....',
      'nnnnnddddnnnddddnnnnnnnnnnnn',
      'mmmmmdmmdmmmdmmdmmmmmmmmmmmm',
      '.oddo.oooo............nn....',
      '.oddooddddo.............nn..',
      '.oddoddoodo.................',
      '.oddodo.odo.................',
      '.odddoooddo.................',
      '..oddddddo..................',
    ],
    head: [20, 0],
    eye: [20, 6],
  },
]

/** Tokens used so far to size: 0 hatchling, 1 young, 2 adult. */
export const EVOLVE_AT = [100_000, 500_000] as const
export function stageOf(tokens: number): 0 | 1 | 2 {
  return tokens >= EVOLVE_AT[1] ? 2 : tokens >= EVOLVE_AT[0] ? 1 : 0
}

/** A colour as hue (0–360), saturation and lightness (0–100). */
export type Hsl = { h: number; s: number; l: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** "#rrggbb" for an HSL colour. */
export function hex({ h, s, l }: Hsl): string {
  const S = clamp(s, 0, 100) / 100
  const L = clamp(l, 0, 100) / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return `#${[f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
}

/** The whole chameleon's palette from its one body colour. */
export function palette(body: Hsl): Record<string, string> {
  const { h, s, l } = body
  return {
    b: hex(body),
    d: hex({ h, s, l: l - 12 }),
    l: hex({ h, s: s * 0.9, l: l + 14 }),
    p: hex({ h, s, l: l - 18 }),
    r: hex({ h, s: s * 0.8, l: l + 8 }),
    o: hex({ h, s: s * 0.55, l: Math.max(12, l - 34) }),
    // Fixed whatever the body colour: the eye and the branch.
    w: '#F3EED6',
    k: '#1E1A16',
    n: '#A8693A',
    m: '#7A4824',
  }
}

/** Context fill at which a working chameleon is fully red. */
export const RED_AT = 0.85

/**
 * A working chameleon's colour from how full its context is: green when
 * there's room, through yellow (~45%) and orange (~65%) to red at 85%, and a
 * little darker as it fills so the change reads without colour vision too.
 */
export function workingColour(fill: number): Hsl {
  const t = clamp(fill / RED_AT, 0, 1)
  return { h: 120 * (1 - t), s: 68, l: 50 - 10 * t }
}

/**
 * A finished chameleon rests in its model's colour, softer than any working
 * colour (lower saturation, paler), so "vivid" always means "still working".
 */
export const RESTING: Record<'opus' | 'sonnet' | 'haiku' | 'fable', Hsl> = {
  opus: { h: 22, s: 40, l: 58 },
  sonnet: { h: 205, s: 40, l: 56 },
  haiku: { h: 165, s: 36, l: 52 },
  fable: { h: 45, s: 44, l: 56 },
}

/** Grey: a failed agent, or a finished one on a model with no colour of its own. */
export const GREY: Hsl = { h: 0, s: 0, l: 52 }
export const FAILED: Hsl = { h: 0, s: 0, l: 42 }
