import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

/**
 * Stands in for the engine around the panel's pane. `pane` is the panel's row
 * in $.ui.panes(), or undefined when it isn't open; `placed` is what the next
 * $.ui.open answers. Records each open, close and debug line.
 */
const engine = (on: On, world: { pane?: { isPlaced: boolean }; placed: boolean }) => {
  const calls: string[] = []
  const logged: string[] = []
  on('store.get', () => ({ value: 'off' })) // launch "off": nothing opens by itself
  on('ui.panes', () => ({
    value: world.pane ? [{ id: 'agents-panel', title: 'Agents', isShown: world.pane.isPlaced, isFocused: false, isPlaced: world.pane.isPlaced }] : [],
  }))
  on('ui.open', () => {
    calls.push('open')
    world.pane = { isPlaced: world.placed }
    return { value: world.placed ? { isPlaced: true } : { isPlaced: false, reason: 'no-surface' } }
  })
  on('ui.close', () => {
    calls.push('close')
    world.pane = undefined
    return { value: undefined }
  })
  on('ui.log', (_, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  return { calls, logged }
}

/** The person typing /agents-panel with no option. */
const command = { command: 'agents-panel', args: '', origin: { kind: 'person' }, presentation: {} } as never

test('opened before the window can show it: the reply says so and the reason is logged', async ($, on) => {
  const { calls, logged } = engine(on, { placed: false })

  const reply = await $.command.run(command)

  expect(calls).toEqual(['open'])
  expect((reply as { text?: string }).text).toBe('The Agents panel will appear as soon as this window can show it.')
  expect(logged).toEqual(['agents-panel: panel waits undrawn: no-surface'])
})

test('a panel waiting undrawn is opened again, not closed, when the command is typed again', async ($, on) => {
  const { calls } = engine(on, { pane: { isPlaced: false }, placed: true })

  const reply = await $.command.run(command)

  expect(calls).toEqual(['open'])
  expect((reply as { text?: string }).text).toBe('Agents panel opened.')
})

test('a panel on screen is closed by the command, as before', async ($, on) => {
  const { calls } = engine(on, { pane: { isPlaced: true }, placed: true })

  const reply = await $.command.run(command)

  expect(calls).toEqual(['close'])
  expect((reply as { text?: string }).text).toBe('Agents panel closed.')
})

test('when the window attaches, a panel waiting undrawn is opened again', async ($, on) => {
  const world: { pane?: { isPlaced: boolean }; placed: boolean } = { pane: { isPlaced: false }, placed: true }
  const { calls } = engine(on, world)

  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })

  expect(calls).toEqual(['open'])
  expect(world.pane).toEqual({ isPlaced: true })
})

test('attaching leaves the panel alone when it is drawn or not open', async ($, on) => {
  const { calls } = engine(on, { pane: { isPlaced: true }, placed: true })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(calls).toEqual([])
})
