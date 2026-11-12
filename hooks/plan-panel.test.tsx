import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { PlanWindow } from '../types'

const PANE = {
  plugin: 'agents-panel',
  component: 'Pane',
  requestId: 'agents-panel',
  surface: 'desktop',
  props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const NOW = Date.parse('2026-11-12T08:00:00Z')
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString()
const SESSION = { cwd: '/', surface: 'desktop', isInteractive: true } as const

/**
 * Stands in for the engine: a session whose usage reports `windows`, a shared
 * store, and a record of pop-ups. `stored` survives between sessions in a test.
 */
const engine = (on: On, windows: PlanWindow[], stored: Record<string, unknown> = { launch: 'off' }) => {
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'agents-panel' } }))
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: windows, cost: { usd: 0.5 } } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent_1' }))
  return { toasts, stored }
}

const spawn = {
  tool_use_id: 'toolu_1', prompt: 'p', description: 'List folder files', subagentType: 'general-purpose',
  provider: 'session', parentModel: 'claude-opus-5-5', background: true, fork: false,
} as never

test('a subscriber sees their plan and "Value", even before any agent', async ($, on) => {
  engine(on, [
    { kind: 'five_hour', percentUsed: 62, resetsAt: at(100) },
    { kind: 'seven_day', percentUsed: 18, resetsAt: at(6 * 1440 + 360) },
  ])
  await $.session.start(SESSION)

  const empty = await $.ui.mount(PANE)
  expect((await empty.find({ type: 'Text', text: /^Your plan$/ }))?.text).toBe('Your plan')
  expect((await empty.find({ type: 'Text', text: /^62%/ }))?.text).toBe('62%  resets in 1h 40m')
  expect((await empty.find({ type: 'Text', text: /^18%/ }))?.text).toBe('18%  resets in 6d 6h')
  await empty.unmount()

  await $.agent.spawn(spawn)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Value$/ }))?.text).toBe('Value')
  expect(await ui.find({ type: 'Text', text: /^Cost$/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /List-price value/ }))?.text).toBe(
    "List-price value. You're on a plan, so this isn't billed per token.",
  )
  await ui.unmount()
})

test('an API-billed user sees "Cost" and no plan block', async ($, on) => {
  engine(on, [])
  await $.session.start(SESSION)
  await $.agent.spawn(spawn)

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Cost$/ }))?.text).toBe('Cost')
  expect(await ui.find({ type: 'Text', text: /^Your plan$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /List-price value/ })).toBeUndefined()
  await ui.unmount()
})

test('a gateway spend limit alone shows its bar but keeps "Cost"', async ($, on) => {
  engine(on, [{ kind: 'spend_limit', percentUsed: 104, resetsAt: at(600) }])
  await $.session.start(SESSION)
  await $.agent.spawn(spawn)

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Spend limit$/ }))?.text).toBe('Spend limit')
  expect((await ui.find({ type: 'Text', text: /^104%/ }))?.text).toBe('104%  resets in 10h 0m')
  expect((await ui.find({ type: 'Text', text: /^Cost$/ }))?.text).toBe('Cost')
  await ui.unmount()
})

test('an out-of-date window says it has reset, and warns about nothing', async ($, on) => {
  const { toasts } = engine(on, [{ kind: 'five_hour', percentUsed: 96, resetsAt: at(-10) }])
  await $.session.start(SESSION)

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^reset/ }))?.text).toBe('reset, updates after your next message')
  expect(toasts).toEqual([])
  await ui.unmount()
})

test('crossing 75% pops up once, even across sessions in the same window', async ($, on) => {
  const stored: Record<string, unknown> = { launch: 'off' }
  const { toasts } = engine(on, [{ kind: 'five_hour', percentUsed: 78, resetsAt: at(100) }], stored)

  await $.session.start(SESSION)
  expect(toasts).toEqual(['Your 5-hour plan usage is at 78%. It resets in 1h 40m.'])

  // A later reading in the same window, and a second session, both share the record.
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt: at(100) }],
    changed: ['rateLimits'],
  } as never)
  await $.session.start(SESSION)
  expect(toasts.length).toBe(1)
})
