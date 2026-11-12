import { expect, test } from 'claude-code/testing'

import { currencyCode, formatMoney, manualRate, parseRateReply, rateUrl, resolveFx, savedRate, USD } from './money'
import type { SavedRate } from './money'

const DAY = 24 * 60 * 60 * 1000
const REPLY = '{"amount":1.0,"base":"USD","date":"2026-11-11","rates":{"MYR":4.0735}}'

/** resolveFx with a fake network: `reply` is what the fetch answers, or an Error it rejects with. */
const resolve = async (over: {
  code?: string
  manual?: number
  saved?: SavedRate
  reply?: string | Error
}) => {
  const fetched: string[] = []
  const saves: SavedRate[] = []
  const result = await resolveFx({
    code: 'code' in over ? over.code : 'MYR',
    manual: over.manual,
    saved: over.saved,
    now: 10 * DAY,
    fetchText: async url => {
      fetched.push(url)
      if (over.reply instanceof Error) throw over.reply
      return over.reply ?? REPLY
    },
    save: async r => {
      saves.push(r)
    },
  })
  return { ...result, fetched, saves }
}

test('currency codes and rates from /config are read forgivingly', async () => {
  expect(currencyCode(' myr ')).toBe('MYR')
  expect(currencyCode('ringgit')).toBeUndefined()
  expect(currencyCode('')).toBeUndefined()
  expect(manualRate(' 4.07 ')).toBe(4.07)
  expect(manualRate('')).toBeUndefined()
  expect(manualRate('-1')).toBeUndefined()
  expect(manualRate('abc')).toBeUndefined()
})

test('a frankfurter.dev reply gives the rate and its date', async () => {
  expect(parseRateReply(REPLY, 'MYR')).toEqual({ rate: 4.0735, date: '2026-11-11' })
  expect(parseRateReply(REPLY, 'SGD')).toBeUndefined()
  expect(parseRateReply('<html>moved</html>', 'MYR')).toBeUndefined()
})

test('US dollars never touch the network', async () => {
  const r = await resolve({ code: 'USD' })
  expect(r.fx).toEqual(USD)
  expect(r.fetched).toEqual([])
  expect((await resolve({ code: undefined })).fetched).toEqual([])
})

test('the first look fetches the day\'s rate and saves it', async () => {
  const r = await resolve({})
  expect(r.fetched).toEqual([rateUrl('MYR')])
  expect(r.fx).toEqual({ code: 'MYR', rate: 4.0735, source: 'live', date: '2026-11-11' })
  expect(r.saves).toEqual([{ code: 'MYR', rate: 4.0735, date: '2026-11-11', fetchedAt: 10 * DAY }])
})

test('a rate saved within the day is reused without a fetch', async () => {
  const r = await resolve({ saved: { code: 'MYR', rate: 4.05, date: '2026-11-10', fetchedAt: 10 * DAY - 1000 } })
  expect(r.fetched).toEqual([])
  expect(r.fx.rate).toBe(4.05)
})

test('a saved rate for another currency is ignored', async () => {
  const r = await resolve({ saved: { code: 'SGD', rate: 1.3, date: '2026-11-11', fetchedAt: 10 * DAY } })
  expect(r.fetched.length).toBe(1)
  expect(r.fx.code).toBe('MYR')
})

test('when the fetch fails: manual rate, then an older saved rate, then US dollars', async () => {
  const blocked = new Error('refused by policy')
  const old: SavedRate = { code: 'MYR', rate: 4.1, date: '2026-11-01', fetchedAt: 0 }

  const manual = await resolve({ reply: blocked, manual: 4.0, saved: old })
  expect(manual.fx).toEqual({ code: 'MYR', rate: 4.0, source: 'manual' })
  expect(manual.problem).toBe('refused by policy')

  const cached = await resolve({ reply: blocked, saved: old })
  expect(cached.fx).toEqual({ code: 'MYR', rate: 4.1, source: 'cached', date: '2026-11-01' })

  const none = await resolve({ reply: blocked })
  expect(none.fx).toEqual(USD)
  expect(none.problem).toBe('refused by policy')
})

test('a currency the service does not list falls back and says why', async () => {
  const r = await resolve({ code: 'VND', reply: '{"rates":{}}', manual: 25000 })
  expect(r.fx).toEqual({ code: 'VND', rate: 25000, source: 'manual' })
  expect(r.problem?.includes('VND')).toBe(true)
})

test('only a well-formed saved rate is trusted', async () => {
  expect(savedRate({ code: 'MYR', rate: 4, date: 'd', fetchedAt: 1 })).toEqual({ code: 'MYR', rate: 4, date: 'd', fetchedAt: 1 })
  expect(savedRate(undefined)).toBeUndefined()
  expect(savedRate({ code: 'MYR', rate: -4, date: 'd', fetchedAt: 1 })).toBeUndefined()
  expect(savedRate('4.07')).toBeUndefined()
})

test('amounts convert and keep three decimals under one unit', async () => {
  expect(formatMoney(0.018, USD)).toBe('$0.018')
  expect(formatMoney(2.5, USD)).toBe('$2.50')
  const myr = { code: 'MYR', rate: 4, source: 'live' } as const
  // The symbol depends on the runtime's locale (RM, MYR…); the number doesn't.
  expect(formatMoney(0.018, myr).includes('0.072')).toBe(true)
  expect(formatMoney(2.5, myr).includes('10.00')).toBe(true)
})
