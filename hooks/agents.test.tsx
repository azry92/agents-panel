import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The panel, as the engine would mount it.
const PANE = {
  plugin: 'agents-panel',
  component: 'Pane',
  requestId: 'agents-panel',
  surface: 'desktop',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/** Stands in for the engine: answers each spawn with `started`, and keeps the panel's opens quiet. */
const engine = (on: On, started: { model: string; agentId?: string }, clockFails = false) => {
  on('store.get', () => ({ value: 'off' })) // launch "off": no auto-open to stub
  on('store.set', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => {
    if (clockFails) throw new Error('clock unavailable')
    return { value: 1_000 }
  })
  on('agent.spawn', () => started)
}

/** An Agent tool call's spawn, with only what these tests vary spelled out. */
const spawn = (over: { description: string; resume?: { agentId: string } }) =>
  ({
    tool_use_id: 'toolu_1',
    prompt: 'List the files.',
    subagentType: 'general-purpose',
    provider: 'session',
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    ...over,
  }) as never

test('a spawn with no agent id adds no row', async ($, on) => {
  engine(on, { model: 'claude-haiku-5-5' })
  await $.agent.spawn(spawn({ description: 'Answered by another plugin' }))

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /No subagents yet/ }))?.text).toBe('No subagents yet')
  expect(await ui.find({ type: 'Text', text: /Answered by another plugin/ })).toBeUndefined()
  await ui.unmount()
})

test('a new agent gets a running row', async ($, on) => {
  engine(on, { model: 'claude-haiku-5-5', agentId: 'agent_1' })
  await $.agent.spawn(spawn({ description: 'List folder files' }))

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /List folder files/ }))?.text).toBe('List folder files')
  expect((await ui.find({ type: 'Text', text: /^Running$/ }))?.text).toBe('Running')
  await ui.unmount()
})

test('a resumed agent keeps its row instead of starting over', async ($, on) => {
  engine(on, { model: 'claude-haiku-5-5', agentId: 'agent_1' })
  await $.agent.spawn(spawn({ description: 'List folder files' }))
  await $.agent.spawn(spawn({ description: 'Follow-up message', resume: { agentId: 'agent_1' } }))

  const ui = await $.ui.mount(PANE)
  // Replaced, the row would carry the follow-up's description and its totals would restart at zero.
  expect((await ui.find({ type: 'Text', text: /List folder files/ }))?.text).toBe('List folder files')
  expect(await ui.find({ type: 'Text', text: /Follow-up message/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Running 1$/ }))?.text).toBe('Running 1')
  await ui.unmount()
})

test('with MYR chosen, the panel shows ringgit, its rate and Claude Code\'s own session total', { options: { currency: 'MYR' } }, async ($, on) => {
  const stored: Record<string, unknown> = { launch: 'off' }
  const fetched: string[] = []
  on('command.register', () => ({ value: { command: 'agents-panel' } }))
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('http.fetch', (_, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: '{"date":"2026-11-11","rates":{"MYR":4}}' } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0.5 } } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent_1' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(spawn({ description: 'List folder files' }))

  const ui = await $.ui.mount(PANE)
  expect(fetched).toEqual(['https://api.frankfurter.dev/v1/latest?from=USD&to=MYR'])
  expect((await ui.find({ type: 'Text', text: /ECB rate/ }))?.text).toBe('MYR at the ECB rate of 2026-11-11')
  // US$0.50 at 4 MYR: the symbol is the runtime's (RM, MYR…), the number isn't.
  const total = (await ui.find({ type: 'Text', text: /Whole session/ }))?.text ?? ''
  expect(total.includes('2.00')).toBe(true)
  // The rate is saved, so the next session within the day makes no request.
  expect(stored.rate).toEqual({ code: 'MYR', rate: 4, date: '2026-11-11', fetchedAt: 1_000 })
  await ui.unmount()
})

test('a tracking failure goes to the debug log, and the agent still starts', async ($, on) => {
  const logged: string[] = []
  engine(on, { model: 'claude-haiku-5-5', agentId: 'agent_1' }, true)
  on('ui.log', (_, e) => {
    logged.push(e.text)
    return { value: undefined }
  })

  const started = await $.agent.spawn(spawn({ description: 'List folder files' }))

  expect(started.agentId).toBe('agent_1')
  // The reason is the engine's own words, so only the panel's part is checked.
  expect(logged.length).toBe(1)
  expect(logged[0]?.startsWith("agents-panel: couldn't track agent agent_1: ")).toBe(true)
})
