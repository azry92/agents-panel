import { expect, test } from 'claude-code/testing'

import { ACCESSORIES, accessoryFor } from './accessories'
import { avatarSvg, colourFor } from './avatar'
import { FAILED, GREY, RED_AT, RESTING, STAGES, palette, stageOf, workingColour } from './chameleon'

const hue = (fill: number) => Math.round(workingColour(fill).h)

test('a working chameleon goes green, yellow, orange, red as its context fills', async () => {
  expect(hue(0)).toBe(120) // green
  expect(hue(0.45)).toBe(56) // yellow
  expect(hue(0.65)).toBe(28) // orange
  expect(hue(RED_AT)).toBe(0) // red
  expect(hue(1)).toBe(0) // stays red past 85%
})

test('it also gets darker as it fills, so the change shows without colour', async () => {
  expect(workingColour(0).l).toBeGreaterThan(workingColour(0.5).l)
  expect(workingColour(0.5).l).toBeGreaterThan(workingColour(1).l)
})

test('a finished chameleon rests in its model\'s colour, wherever the model runs', async () => {
  expect(colourFor('done', 0.9, 'claude-opus-5-5')).toEqual(RESTING.opus)
  expect(colourFor('done', 0.9, 'us.anthropic.claude-opus-5-5-v1:0')).toEqual(RESTING.opus)
  expect(colourFor('done', 0.9, 'claude-sonnet-5-5@20261001')).toEqual(RESTING.sonnet)
  expect(colourFor('done', 0.9, 'claude-haiku-5-5')).toEqual(RESTING.haiku)
  expect(colourFor('done', 0.9, 'claude-fable-5-2[1m]')).toEqual(RESTING.fable)
  expect(colourFor('done', 0.9, 'openai/gpt-5-mini')).toEqual(GREY)
  // A model name that happens to be an object property is still just "other".
  expect(colourFor('done', 0, 'constructor')).toEqual(GREY)
})

test('running uses the fill, failed is grey whatever the model', async () => {
  expect(colourFor('running', 0.45, 'claude-opus-5-5')).toEqual(workingColour(0.45))
  expect(colourFor('failed', 0.1, 'claude-opus-5-5')).toEqual(FAILED)
})

test('resting colours are softer than any working colour, so vivid means working', async () => {
  for (const r of Object.values(RESTING)) expect(r.s).toBeLessThan(workingColour(0).s)
  // Haiku rests in teal, not the green a fresh agent works in.
  expect(Math.abs(RESTING.haiku.h - workingColour(0).h)).toBeGreaterThan(30)
})

test('each agent type gets its accessory', async () => {
  expect(accessoryFor('Explore')).toBe('magnifier')
  expect(accessoryFor('feature-dev:code-reviewer')).toBe('glasses')
  expect(accessoryFor('silent-failure-hunter')).toBe('none')
  expect(accessoryFor('claude-code-guide')).toBe('gradcap')
  expect(accessoryFor('ui-builder')).toBe('hardhat') // builds before it designs
  expect(accessoryFor('design:design-critique')).toBe('beret')
  expect(accessoryFor('Plan')).toBe('cap')
  expect(accessoryFor('feature-dev:code-architect')).toBe('cap')
  expect(accessoryFor('general-purpose')).toBe('none')
})

test('every sprite is a clean grid within its size, with its points on the sprite', async () => {
  const limits = [[14, 11], [20, 16], [28, 22]]
  STAGES.forEach((s, i) => {
    const w = s.rows[0]?.length ?? 0
    expect(s.rows.every(r => r.length === w)).toBe(true)
    expect(w <= limits[i]![0]! && s.rows.length <= limits[i]![1]!).toBe(true)
    for (const [x, y] of [s.head, s.eye]) expect(x >= 0 && x < w && y >= 0 && y < s.rows.length).toBe(true)
    // Every key a sprite uses has a colour.
    const keys = new Set(s.rows.join('').replace(/\./g, ''))
    const colors = palette(GREY)
    expect([...keys].filter(k => !colors[k])).toEqual([])
  })
})

test('every size has the same eye: 2x2 pupil, 4x4 white, round 6x6 ring', async () => {
  for (const s of STAGES) {
    const [x, y] = s.eye
    const at = (dx: number, dy: number) => s.rows[y + dy]?.[x + dx]
    expect([at(0, 0), at(1, 0), at(0, 1), at(1, 1)]).toEqual(['k', 'k', 'k', 'k'])
    // White on both sides of the pupil, so it can look left and right.
    expect([at(-1, 0), at(2, 0), at(-1, 1), at(2, 1)]).toEqual(['w', 'w', 'w', 'w'])
    // The ring's straight edges, where the glasses' frame and the lens sit.
    expect(s.rows[y - 2]?.slice(x - 1, x + 3)).toBe('rrrr')
    expect(s.rows[y + 3]?.slice(x - 1, x + 3)).toBe('rrrr')
  }
})

test('the branch and the eye keep their colours whatever the chameleon turns', async () => {
  const states = [workingColour(0), workingColour(1), RESTING.sonnet, GREY, FAILED].map(palette)
  for (const key of ['n', 'm', 'w', 'k']) expect(new Set(states.map(p => p[key])).size).toBe(1)
  // ...while the body really does change.
  expect(new Set(states.map(p => p.b)).size).toBe(states.length)
})

test('the eye looks around only while the agent works', async () => {
  const svg = (status: 'running' | 'done' | 'failed') =>
    avatarSvg({ model: 'claude-opus-5-5', type: 'general-purpose', status, tokens: 0, fill: 0.2 })
  expect(svg('running').includes('animation:look')).toBe(true)
  expect(svg('done').includes('animation:look')).toBe(false)
  expect(svg('failed').includes('animation:look')).toBe(false)
  // The pupil is in its own group, so only it moves.
  expect(svg('running').includes('<g class="look"><rect')).toBe(true)
})

test('chameleons grow at 100k and 500k tokens', async () => {
  expect([stageOf(0), stageOf(99_999), stageOf(100_000), stageOf(500_000)]).toEqual([0, 0, 1, 2])
})

test('only a running magnifier moves; nothing else animates', async () => {
  const svg = (type: string, status: 'running' | 'done') =>
    avatarSvg({ model: 'claude-opus-5-5', type, status, tokens: 0, fill: 0.2 })
  expect(svg('Explore', 'running').includes('animation:sweep')).toBe(true)
  expect(svg('Explore', 'done').includes('animation:sweep')).toBe(false)
  expect(svg('general-purpose', 'running').includes('bob')).toBe(false)
  expect(Object.keys(ACCESSORIES).filter(k => ACCESSORIES[k as keyof typeof ACCESSORIES].cls)).toEqual(['magnifier'])
})
