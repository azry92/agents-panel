import { expect, test } from 'claude-code/testing'

import { barFill, isStale, isSubscriber, levelOf, percentText, pruneWarned, resetsIn, warningsDue, windowLabel } from './plan'
import type { PlanWindow } from './plan'

const NOW = Date.parse('2026-11-12T08:00:00Z')
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString()
const win = (kind: string, percentUsed: number, resetMins = 100): PlanWindow => ({ kind, percentUsed, resetsAt: at(resetMins) })

test('windows get plain names, and new kinds still read', async () => {
  expect(windowLabel('five_hour')).toBe('5-hour')
  expect(windowLabel('seven_day')).toBe('Weekly')
  expect(windowLabel('spend_limit')).toBe('Spend limit')
  expect(windowLabel('seven_day_opus')).toBe('seven day opus')
})

test('a 5-hour or weekly window means a subscriber; a spend limit alone does not', async () => {
  expect(isSubscriber([win('five_hour', 10)])).toBe(true)
  expect(isSubscriber([win('seven_day', 10)])).toBe(true)
  expect(isSubscriber([win('spend_limit', 10)])).toBe(false)
  expect(isSubscriber([])).toBe(false)
})

test('bars turn yellow at 75% and red at 90%', async () => {
  expect([74.9, 75, 89.9, 90, 104].map(p => levelOf(win('five_hour', p), NOW))).toEqual(['ok', 'warn', 'warn', 'high', 'high'])
})

test('a window past its reset time is out of date, whatever its percentage', async () => {
  const old = win('five_hour', 95, -5)
  expect(isStale(old, NOW)).toBe(true)
  expect(levelOf(old, NOW)).toBe('stale')
  expect(isStale({ kind: 'five_hour', percentUsed: 95 }, NOW)).toBe(false) // no reset time: trust it
})

test('reset times read as time from now', async () => {
  expect(resetsIn(at(100), NOW)).toBe('1h 40m')
  expect(resetsIn(at(12), NOW)).toBe('12m')
  expect(resetsIn(at(6 * 1440 + 6 * 60 + 5), NOW)).toBe('6d 6h')
  expect(resetsIn(at(0), NOW)).toBe('under a minute')
  expect(resetsIn(undefined, NOW)).toBeUndefined()
  expect(resetsIn('not a date', NOW)).toBeUndefined()
})

test('over 100%: a full bar, and the real figure in the text', async () => {
  expect(barFill(win('spend_limit', 104))).toBe(1)
  expect(percentText(win('spend_limit', 104))).toBe('104%')
  expect(barFill(win('five_hour', 62.5))).toBe(0.625)
})

test('each threshold warns once per window', async () => {
  const w = win('five_hour', 80)
  const first = warningsDue([w], [], NOW)
  expect(first.map(x => x.text)).toEqual(['Your 5-hour plan usage is at 80%. It resets in 1h 40m.'])

  const warned = first.map(x => x.key)
  expect(warningsDue([win('five_hour', 82)], warned, NOW)).toEqual([])
  // Then 90% is new.
  expect(warningsDue([win('five_hour', 91)], warned, NOW).map(x => x.text)).toEqual([
    'Your 5-hour plan usage is at 91%. It resets in 1h 40m.',
  ])
})

test('a new window warns again', async () => {
  const warned = warningsDue([win('five_hour', 80, 100)], [], NOW).map(x => x.key)
  // Same kind, a later reset time: a fresh window.
  expect(warningsDue([win('five_hour', 80, 400)], warned, NOW).length).toBe(1)
})

test('jumping past both thresholds shows one warning but records both', async () => {
  const due = warningsDue([win('seven_day', 93)], [], NOW)
  expect(due.filter(x => x.text).map(x => x.text)).toEqual(['Your weekly plan usage is at 93%. It resets in 1h 40m.'])
  expect(due.length).toBe(2)
  // So falling back to the 75% check later doesn't warn again.
  expect(warningsDue([win('seven_day', 93)], due.map(x => x.key), NOW)).toEqual([])
})

test('out-of-date windows and windows under 75% warn about nothing', async () => {
  expect(warningsDue([win('five_hour', 95, -1), win('seven_day', 60)], [], NOW)).toEqual([])
})

test('the warned record only keeps keys for current windows', async () => {
  const current = win('five_hour', 80, 100)
  const keys = [...warningsDue([current], [], NOW), ...warningsDue([win('five_hour', 80, -500)], [], NOW - 600 * 60_000)].map(
    x => x.key,
  )
  expect(pruneWarned(keys, [current])).toEqual(warningsDue([current], [], NOW).map(x => x.key))
})
