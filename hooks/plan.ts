// Plan usage: the 5-hour and weekly windows a Pro or Max subscription is limited
// by, and a gateway's spend limit. Claude Code reports them with each reply
// ($.session.usage().rateLimits); API billing reports none.
//
// Plain functions only, so all of it is tested without an engine.

import type { PlanWindow } from '../types'

export type { PlanWindow }

/** Warn when a window passes these percentages; the bar turns yellow, then red. */
export const WARN_AT = [75, 90] as const

export type Level = 'ok' | 'warn' | 'high' | 'stale'

const LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly', spend_limit: 'Spend limit' }

/** "5-hour", "Weekly", "Spend limit"; a window kind Claude Code adds later shows as itself. */
export const windowLabel = (kind: string) => LABELS[kind] ?? kind.replace(/_/g, ' ')

/**
 * A subscriber has a 5-hour or weekly window. A spend limit alone is a
 * per-token gateway: its money is real, so the panel keeps calling it cost.
 */
export const isSubscriber = (windows: readonly PlanWindow[]) =>
  windows.some(w => w.kind === 'five_hour' || w.kind === 'seven_day')

/** True once the window's reset time has passed: its percentage is out of date. */
export const isStale = (w: PlanWindow, now: number) => {
  const at = w.resetsAt === undefined ? NaN : Date.parse(w.resetsAt)
  return Number.isFinite(at) && at <= now
}

export function levelOf(w: PlanWindow, now: number): Level {
  if (isStale(w, now)) return 'stale'
  return w.percentUsed >= WARN_AT[1] ? 'high' : w.percentUsed >= WARN_AT[0] ? 'warn' : 'ok'
}

/** "1h 40m", "4d 6h", "12m", "under a minute"; undefined when there's no reset time. */
export function resetsIn(resetsAt: string | undefined, now: number): string | undefined {
  const at = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (!Number.isFinite(at)) return undefined
  const mins = Math.floor((at - now) / 60_000)
  if (mins < 1) return 'under a minute'
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** "62%"; a spend limit past its cap shows its real figure, e.g. "104%". */
export const percentText = (w: PlanWindow) => `${Math.round(w.percentUsed)}%`

/** The bar's fill, 0 to 1: full once at or past 100%. */
export const barFill = (w: PlanWindow) => Math.min(1, Math.max(0, w.percentUsed / 100))

export type Warning = { key: string; text: string }

/** One warning's identity: the window, which reset it belongs to, and the threshold. */
const warnKey = (w: PlanWindow, at: number) => `${w.kind}@${w.resetsAt ?? ''}:${at}`

/**
 * The warnings to show now: each threshold a window has passed that hasn't
 * been warned about in this window yet. Keys carry the reset time, so a new
 * window warns again. Out-of-date windows warn about nothing. When a window
 * jumps straight past both thresholds, only the higher one is shown.
 */
export function warningsDue(windows: readonly PlanWindow[], warned: readonly string[], now: number): Warning[] {
  const seen = new Set(warned)
  const due: Warning[] = []
  for (const w of windows) {
    if (isStale(w, now)) continue
    const passed = WARN_AT.filter(t => w.percentUsed >= t && !seen.has(warnKey(w, t)))
    const top = passed[passed.length - 1]
    if (top === undefined) continue
    const when = resetsIn(w.resetsAt, now)
    const text = `Your ${windowLabel(w.kind).toLowerCase()} plan usage is at ${percentText(w)}.${when ? ` It resets in ${when}.` : ''}`
    // Record every threshold passed, so skipping straight to 90% doesn't warn at 75% later.
    for (const t of passed) due.push({ key: warnKey(w, t), text: t === top ? text : '' })
  }
  return due
}

/** Keeps the warned list from growing forever: only keys for windows still current. */
export const pruneWarned = (warned: readonly string[], windows: readonly PlanWindow[]) => {
  const live = new Set(windows.map(w => `${w.kind}@${w.resetsAt ?? ''}:`))
  return warned.filter(k => [...live].some(p => k.startsWith(p)))
}
