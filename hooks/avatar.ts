import type { AgentStatus } from '../types'
import { ACCESSORIES, accessoryFor } from './accessories'
import { FAILED, GREY, RESTING, STAGES, palette, stageOf, workingColour } from './chameleon'
import type { Hsl } from './chameleon'
import { coreId } from './models'

/**
 * Pixel chameleon avatars. Each subagent's chameleon:
 *  - changes colour while it works, green to red as its context fills (colourFor)
 *  - rests in its model's colour when done, grey if it failed
 *  - grows as it uses tokens (stageOf)
 *  - wears an accessory from its agent type (accessoryFor)
 */

/** The chameleon's body colour for an agent's state. */
export function colourFor(status: AgentStatus, fill: number, model: string): Hsl {
  if (status === 'failed') return FAILED
  if (status === 'running') return workingColour(fill)
  // Read the family from the bare model name, so Bedrock, Vertex and gateway IDs rest in the same colour.
  const family = coreId(model).split('-')[0] ?? ''
  return Object.hasOwn(RESTING, family) ? RESTING[family as keyof typeof RESTING] : GREY
}

const U = 3 // px per pixel
const W = 32 // canvas, in pixels: the adult (28x22) plus room for hats above
const H = 26

const rects = (rows: [number, number, string][], colors: Record<string, string>, dx = 0, dy = 0) =>
  rows
    .flatMap(([x0, y, row]) =>
      [...row].map((ch, i) => {
        const x = x0 + i + dx
        const yy = y + dy
        if (ch === '.' || !colors[ch] || x < 0 || yy < 0 || x >= W || yy >= H) return ''
        return `<rect x="${x * U}" y="${yy * U}" width="${U}" height="${U}" fill="${colors[ch]}"/>`
      }),
    )
    .join('')

export const AVATAR_W = W * U
export const AVATAR_H = H * U

export function avatarSvg(opts: {
  model: string
  type: string
  status: AgentStatus
  tokens: number
  /** How full the agent's context is, 0 to 1. */
  fill: number
}): string {
  const { model, type, status, tokens, fill } = opts
  const sprite = STAGES[stageOf(tokens)]
  const colors = palette(colourFor(status, fill, model))

  // Stand the sprite on the bottom edge, centred.
  const sw = sprite.rows[0]?.length ?? 0
  const sx = Math.floor((W - sw) / 2)
  const sy = H - sprite.rows.length
  const placed = sprite.rows.map((r, i) => [sx, sy + i, r] as [number, number, string])
  // The pupil is drawn on its own so it can look around while the agent works.
  const body = rects(placed, { ...colors, k: '' })
  const pupil = rects(placed, { k: colors.k ?? '#1E1A16' })

  // An accessory sits on the crest (hats) or the eye (glasses, magnifier).
  const kind = accessoryFor(type)
  const art = kind === 'none' ? undefined : ACCESSORIES[kind]
  const spot = art ? (art.on === 'eye' ? sprite.eye : sprite.head) : undefined
  const ax = art && spot ? sx + spot[0] : 0
  const ay = art && spot ? sy + spot[1] : 0
  const accessory = art
    ? `<g class="${art.cls ?? ''}">${rects(art.rows, art.colors, ax - art.at[0], ay - art.at[1])}</g>`
    : ''
  const working = status === 'running'
  const sweep = working ? 'sweep 1.6s ease-in-out infinite' : 'none'
  const look = working ? 'look 3.2s steps(1) infinite' : 'none'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_W}" height="${AVATAR_H}" viewBox="0 0 ${AVATAR_W} ${AVATAR_H}" shape-rendering="crispEdges">
<style>
.sweep{transform-box:view-box;transform-origin:${(ax + 0.5) * U}px ${(ay + 0.5) * U}px;animation:${sweep}}
.look{animation:${look}}
.idle{opacity:${status === 'done' ? 0.7 : 1}}
@keyframes sweep{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(8deg)}}
@keyframes look{0%{transform:translateX(0)}30%{transform:translateX(-${U}px)}55%{transform:translateX(0)}78%{transform:translateX(${U}px)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<g class="idle">${body}<g class="look">${pupil}</g>${accessory}</g>
</svg>`
}
