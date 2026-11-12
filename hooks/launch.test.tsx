import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The band above the prompt, as the engine would mount it.
const BAND = {
  plugin: 'agents-panel',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

/** Stands in for the engine: a $.store backed by `stored`, and a record of opened panes. */
const engine = (on: On, stored: Record<string, unknown>) => {
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'agents-panel' } }))
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return opened
}

const SESSION = { cwd: '/', surface: 'desktop', isInteractive: true } as const

test('a fresh install asks the setup question once and does not open the panel', async ($, on) => {
  const stored: Record<string, unknown> = {}
  const opened = engine(on, stored)
  await $.session.start(SESSION)

  expect(opened).toEqual([])
  expect(stored.setupShown).toBe(1)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /When should it open/ }))?.text).toBe(
    'Agents panel installed. When should it open?',
  )
  await ui.unmount()
})

test('the setup question stops after three unanswered sessions', async ($, on) => {
  const stored: Record<string, unknown> = { setupShown: 3 }
  engine(on, stored)
  await $.session.start(SESSION)

  expect(stored.setupShown).toBe(3)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /When should it open/ })).toBeUndefined()
  await ui.unmount()
})

test('a saved "ask" shows the per-session question', async ($, on) => {
  engine(on, { launch: 'ask' })
  await $.session.start(SESSION)

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /for this session/ }))?.text).toBe(
    'Open the Agents panel for this session?',
  )
  await ui.unmount()
})

test('the /config option beats the saved choice', { options: { launch: 'always' } }, async ($, on) => {
  const opened = engine(on, { launch: 'off' })
  await $.session.start(SESSION)

  expect(opened).toEqual(['agents-panel'])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /When should it open|for this session/ })).toBeUndefined()
  await ui.unmount()
})
