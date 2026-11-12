// Showing US-dollar estimates in the person's own currency.
//
// Rates come once a day from the European Central Bank's reference rates,
// through frankfurter.dev (free, no key). The request carries only the currency
// code. If it can't be reached, a manual rate from /config is used, then the
// last rate fetched, and failing all of those the panel stays in US dollars.

import type { Fx } from '../types'

export type { Fx }

/** What's kept between sessions, so the panel fetches at most once a day. */
export type SavedRate = { code: string; rate: number; date: string; fetchedAt: number }

export const USD: Fx = { code: 'USD', rate: 1, source: 'live' }

const DAY = 24 * 60 * 60 * 1000

export const rateUrl = (code: string) => `https://api.frankfurter.dev/v1/latest?from=USD&to=${code}`

/** A rate saved by an earlier session, if what's stored still has that shape. */
export const savedRate = (v: unknown): SavedRate | undefined => {
  const r = v as Partial<SavedRate> | null
  return r &&
    typeof r.code === 'string' &&
    typeof r.rate === 'number' &&
    r.rate > 0 &&
    typeof r.date === 'string' &&
    typeof r.fetchedAt === 'number'
    ? (r as SavedRate)
    : undefined
}

/** "myr " → "MYR"; anything that isn't a three-letter code → undefined. */
export const currencyCode = (s: string): string | undefined => {
  const c = s.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(c) ? c : undefined
}

/** A typed exchange rate: a positive number, else undefined. */
export const manualRate = (s: string): number | undefined => {
  const n = Number(s.trim())
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined
}

/** The rate for `code` from a frankfurter.dev reply, or undefined if it isn't there. */
export function parseRateReply(text: string, code: string): { rate: number; date: string } | undefined {
  try {
    const body = JSON.parse(text) as { date?: unknown; rates?: Record<string, unknown> }
    const rate = body.rates?.[code]
    if (typeof rate !== 'number' || !(rate > 0)) return undefined
    return { rate, date: typeof body.date === 'string' ? body.date : '' }
  } catch {
    return undefined
  }
}

/**
 * Picks the rate to show, fetching only when the saved one is missing or a day old.
 * Order: today's saved rate, a fresh fetch, the manual rate, an older saved rate, US dollars.
 */
export async function resolveFx(args: {
  code: string | undefined
  manual: number | undefined
  saved: SavedRate | undefined
  now: number
  /** Resolves the reply's text, or rejects when the network refuses. */
  fetchText: (url: string) => Promise<string>
  save: (r: SavedRate) => Promise<void>
}): Promise<{ fx: Fx; problem?: string }> {
  const { code, manual, now } = args
  if (!code || code === 'USD') return { fx: USD }
  const saved = args.saved?.code === code ? args.saved : undefined

  if (saved && now - saved.fetchedAt < DAY) return { fx: { code, rate: saved.rate, source: 'live', date: saved.date } }

  let problem: string
  try {
    const got = parseRateReply(await args.fetchText(rateUrl(code)), code)
    if (got) {
      await args.save({ code, ...got, fetchedAt: now })
      return { fx: { code, rate: got.rate, source: 'live', date: got.date } }
    }
    problem = `no ${code} rate in the reply (the service may not list ${code})`
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err)
  }

  if (manual) return { fx: { code, rate: manual, source: 'manual' }, problem }
  if (saved) return { fx: { code, rate: saved.rate, source: 'cached', date: saved.date }, problem }
  return { fx: USD, problem }
}

/**
 * A US-dollar amount in the chosen currency: "$0.018", "RM0.073", "¥3".
 * Amounts under one unit keep three decimals so small agents don't all read 0.00.
 */
export function formatMoney(usd: number, fx: Fx): string {
  const v = usd * fx.rate
  if (fx.code === 'USD') return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`
  const digits = v !== 0 && Math.abs(v) < 1 ? 3 : 2
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: fx.code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v)
  } catch {
    // A runtime without currency formatting still shows the code and the number.
    return `${fx.code} ${v.toFixed(digits)}`
  }
}
