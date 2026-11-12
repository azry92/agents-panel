import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { AgentRun, AgentStatus, Fx } from '../types'
import { AVATAR_H, AVATAR_W, avatarSvg } from './avatar'
import { currencyCode, formatMoney, manualRate, resolveFx, savedRate, USD } from './money'
import { costOf, modelInfo, parsePriceOverrides } from './models'

const PANE = 'agents-panel'
const TITLE = 'Agents'

// Bump the shape tag when AgentRun's fields change: it drops what an older
// version stored, which outlives a reload.
const agents = atom({ plugin: 'agents-panel', key: 'agents' } as const, [], { shape: 'agents-2' })
const now = atom({ plugin: 'agents-panel', key: 'now' } as const, 0)
const autoOpened = atom({ plugin: 'agents-panel', key: 'autoOpened' } as const, false)
const finishedCollapsed = atom({ plugin: 'agents-panel', key: 'finishedCollapsed' } as const, false)
/** Which question the band above the prompt shows: the first-run setup, the per-session "open it?", or none. */
const band = atom({ plugin: 'agents-panel', key: 'band' } as const, 'none')
const fx = atom({ plugin: 'agents-panel', key: 'fx' } as const, USD)
const fxProblem = atom({ plugin: 'agents-panel', key: 'fxProblem' } as const, '')
const sessionUsd = atom({ plugin: 'agents-panel', key: 'sessionUsd' } as const, -1)

const RATE_KEY = 'rate' // $.store: the last exchange rate fetched, so it's fetched at most once a day

/** A line in the debug log (claude --debug). Never throws: logging must not break the panel. */
const debug = ($: EngineInterface, text: string) =>
  Promise.resolve()
    .then(() => $.ui.log(`agents-panel: ${text}`, { to: 'debug' }))
    .catch(() => {})

/**
 * Opens the panel and says whether it's on screen now. A pane opened before
 * the window is attached waits undrawn; the reason goes to the debug log.
 */
const openPanel = async ($: EngineInterface): Promise<boolean> => {
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  if (!opened.isPlaced) void debug($, `panel waits undrawn: ${opened.reason}`)
  return opened.isPlaced
}

/** The panel's row in the open panes, if it's open at all (drawn or waiting). */
const panelPane = async ($: EngineInterface) => (await $.ui.panes()).find(p => p.id === PANE)

/** Picks the currency's rate for this session: fetched at most once a day, else a fallback. */
const refreshFx = async ($: EngineInterface, currency: string | undefined, fallbackRate: number | undefined) => {
  const { fx: chosen, problem } = await resolveFx({
    code: currency,
    manual: fallbackRate,
    saved: savedRate(await $.store.get(RATE_KEY)),
    now: await $.clock.now(),
    fetchText: async url => {
      const r = await $.http.fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.text
    },
    save: r => $.store.set(RATE_KEY, r),
  })
  await update($, fx, () => chosen)
  await update($, fxProblem, () =>
    problem && chosen.code !== currency ? `Couldn't get today's ${currency} rate, so amounts are in US$.` : '',
  )
  if (problem) void debug($, `exchange rate for ${currency}: ${problem}`)
}

// ── Usage maths ────────────────────────────────────────────────────────────

const sumTokens = (u: ModelUsage) =>
  (u.input_tokens || 0) +
  (u.output_tokens || 0) +
  (u.cache_read_input_tokens || 0) +
  (u.cache_creation_input_tokens || 0)

// ── Formatting ─────────────────────────────────────────────────────────────

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

/**
 * "≈$0.018" or "≈RM0.073"; with "+" when part of it couldn't be priced;
 * "price unknown" when none of it could. Never zero for a model with no price.
 */
const fmtSpend = (usd: number, unpriced: boolean, money: Fx) =>
  unpriced && usd === 0 ? 'price unknown' : `≈${formatMoney(usd, money)}${unpriced ? '+' : ''}`

const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const textBar = (fill: number, width = 14) => {
  const full = Math.round(Math.min(1, Math.max(0, fill)) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

const elapsed = (a: AgentRun, at: number) => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

/**
 * Marks a finished run as running again. Its start moves forward by the idle
 * gap, so its time keeps what it had and doesn't count the wait in between.
 */
const reopen = (a: AgentRun, at: number): AgentRun =>
  a.status === 'running'
    ? a
    : { ...a, status: 'running', startedAt: a.startedAt + Math.max(0, at - (a.endedAt ?? at)), endedAt: undefined }


// ── Context gauge (desktop) ────────────────────────────────────────────────

const BAR_W = 132
const BAR_H = 6
// One accent for live work; finished runs fall back to neutral.
const ACCENT = '#D97757'
const NEUTRAL = '#8E8E93'

const gaugeSvg = (fill: number, status: AgentStatus) => {
  const f = Math.min(1, Math.max(0, fill))
  const w = f > 0 ? Math.max(BAR_H, Math.round(f * BAR_W)) : 0
  const color = status === 'running' ? ACCENT : NEUTRAL
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_W}" height="${BAR_H}" viewBox="0 0 ${BAR_W} ${BAR_H}">
<rect width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${NEUTRAL}" fill-opacity=".22"/>
${w ? `<rect width="${w}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>` : ''}
</svg>`
}

const STATUS_TEXT: Record<AgentStatus, { label: string; color: string }> = {
  running: { label: 'Running', color: 'claude' },
  done: { label: 'Done', color: 'success' },
  failed: { label: 'Failed', color: 'error' },
}

// ── Launch preference ──────────────────────────────────────────────────────

type Launch = 'always' | 'ask' | 'subagent' | 'off'
const LAUNCH_KEY = 'launch' // $.store: the choice from the setup question or /agents-panel <option>
const SETUP_SHOWN_KEY = 'setupShown' // $.store: sessions the setup question has appeared in
const SETUP_MAX = 3 // stop asking after this many sessions without an answer
const LAUNCH_TEXT: Record<Launch, string> = {
  always: 'open at the start of every session',
  ask: 'ask at the start of every session',
  subagent: 'open when the first subagent starts',
  off: 'open only when you type /agents-panel',
}
const isLaunch = (v: unknown): v is Launch => typeof v === 'string' && v in LAUNCH_TEXT

type Store = { store: { get: (k: string) => Promise<unknown> } }

/**
 * Where the launch setting comes from, strongest first:
 * 1. the /config option, when set to anything but "auto"
 * 2. the choice saved from the setup question or /agents-panel <option>
 * 3. "subagent", the default that is never in the way
 */
const launchOf = async ($: Store, configured: string): Promise<Launch> => {
  if (isLaunch(configured)) return configured
  const saved = await $.store.get(LAUNCH_KEY)
  return isLaunch(saved) ? saved : 'subagent'
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const configured = String(options.launch ?? 'auto')
  const overrides = parsePriceOverrides(String(options.prices ?? ''))
  const info = (model: string) => modelInfo(model, overrides)
  const currency = currencyCode(String(options.currency ?? 'USD'))
  const fallbackRate = manualRate(String(options.exchangeRate ?? ''))

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agents-panel',
      description: 'Toggle the subagents panel, or set when it opens: always, ask, subagent, off',
    })
    const launch = await launchOf($, configured)
    if (launch === 'always') void openPanel($)
    if (launch === 'ask') await update($, band, () => 'ask')

    // First run: nothing chosen anywhere yet, so ask once which launch mode to keep.
    const saved = await $.store.get(LAUNCH_KEY)
    if (!isLaunch(configured) && !isLaunch(saved)) {
      const shown = Number((await $.store.get(SETUP_SHOWN_KEY)) ?? 0)
      if (shown < SETUP_MAX) {
        await $.store.set(SETUP_SHOWN_KEY, shown + 1)
        await update($, band, () => 'setup')
      }
    }
    // Neither may hold up the session or break it: each runs on its own and logs its failure.
    void refreshFx($, currency, fallbackRate).catch(err => debug($, `exchange rate: ${err instanceof Error ? err.message : String(err)}`))
    void (async () => {
      const cost = (await $.session.usage()).cost
      if (cost) await update($, sessionUsd, () => cost.usd)
    })().catch(err => debug($, `session cost: ${err instanceof Error ? err.message : String(err)}`))

    // Keeps elapsed times moving while anything runs; idle sessions don't redraw.
    void $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        if (list.some(a => a.status === 'running')) {
          const t = await $.clock.now()
          await update($, now, () => t)
        }
      })()
    })
    return next(e)
  })

  // Claude Code's own running total: priced by Claude Code, so it stays right
  // for models this panel has never heard of.
  on('session.measure', async ($, e, next) => {
    const cost = e.cost
    if (cost) await update($, sessionUsd, () => cost.usd)
    return next(e)
  })

  on('command.run', { command: 'agents-panel' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg) {
      if (!isLaunch(arg)) return { text: `Unknown option "${arg}". Use: always, ask, subagent or off.` }
      await $.store.set(LAUNCH_KEY, arg)
      await update($, band, () => 'none')
      if (isLaunch(configured)) {
        return { text: `Saved, but your /config setting "${configured}" takes priority. Set it to "auto" to use this.` }
      }
      return { text: `Agents panel will ${LAUNCH_TEXT[arg]}.` }
    }
    await update($, band, () => 'none')
    // Close only what's on screen: a pane waiting undrawn is one the person can't
    // see, so typing the command again should bring it up, not shut it.
    if ((await panelPane($))?.isPlaced) {
      await $.ui.close({ id: PANE })
      return { text: 'Agents panel closed.' }
    }
    return (await openPanel($))
      ? { text: 'Agents panel opened.' }
      : { text: 'The Agents panel will appear as soon as this window can show it.' }
  })

  // A window joining the session (the desktop app connecting) can show a panel
  // that was opened before it was there: ask again so it's drawn now.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    try {
      const pane = await panelPane($)
      if (pane && !pane.isPlaced) await openPanel($)
    } catch (err) {
      void debug($, `reopening on attach: ${err instanceof Error ? err.message : String(err)}`)
    }
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    // No id means nothing the panel can follow: another plugin answered the
    // spawn without starting one, or the agent runs remotely. A row for it
    // would sit on "Running" for good, so leave it out.
    const agentId = started.agentId
    if (!agentId) return started
    // Bookkeeping only: a failure here must never stop the subagent itself.
    try {
      const at = await $.clock.now()

      // A follow-up to a finished subagent, or a teammate waking, starts the
      // same agent again: carry on its row so what it already spent stays.
      if (e.resume && (await read($, agents)).some(a => a.agentId === agentId)) {
        await update($, agents, list => list.map(a => (a.agentId === agentId ? reopen(a, at) : a)))
        await update($, now, () => at)
        return started
      }

      const run: AgentRun = {
        id: agentId,
        agentId,
        type: e.subagentType || 'general-purpose',
        description: e.description,
        model: started.model,
        status: 'running',
        startedAt: at,
        contextTokens: 0,
        contextMax: info(started.model).window ?? 0,
        tokens: 0,
        costUsd: 0,
        unpriced: false,
        steps: 0,
      }
      await update($, agents, list => [...list.filter(a => a.id !== run.id), run].slice(-200))
      await update($, now, () => at)

      // Open the panel by itself the first time a subagent starts in a session,
      // unless the person turned automatic opening off.
      if (!(await read($, autoOpened)) && (await launchOf($, configured)) !== 'off') {
        await update($, autoOpened, () => true)
        // A per-session "open it?" question is answered by the panel opening; the setup question stays.
        await update($, band, b => (b === 'ask' ? 'none' : b))
        void openPanel($)
      }
    } catch (err) {
      // The panel misses this run; the subagent carries on. Say so in the
      // debug log (claude --debug), so a broken panel isn't a silent one.
      const reason = err instanceof Error ? err.message : String(err)
      void debug($, `couldn't track agent ${agentId}: ${reason}`)
    }
    return started
  })

  // Each model request a subagent makes: context fill, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    if (!e.agentId || !usage) return result

    const model = usage.model || e.model
    const m = info(model)
    const cost = costOf(m, usage)
    const at = await $.clock.now()
    await update($, agents, list =>
      list.map(a =>
        a.agentId !== e.agentId
          ? a
          : {
              // A request from a run marked finished means it's working again (a teammate's next turn).
              ...reopen(a, at),
              model,
              effort: e.effort === undefined ? a.effort : String(e.effort),
              contextTokens: sumTokens(usage),
              contextMax: m.window ?? 0,
              tokens: a.tokens + sumTokens(usage),
              costUsd: a.costUsd + (cost ?? 0),
              unpriced: a.unpriced || cost === undefined,
              steps: a.steps + 1,
            },
      ),
    )
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const at = await $.clock.now()
      const status: AgentStatus = e.reason === 'answer' && !e.isAborted ? 'done' : 'failed'
      await update($, agents, list =>
        list.map(a => {
          if (a.agentId !== e.agentId) return a
          // A run whose steps went unseen still gets the turn's own total.
          if (a.steps > 0 || !e.usage) return { ...a, status, endedAt: at }
          const model = e.usage.model || a.model
          const cost = costOf(info(model), e.usage)
          return {
            ...a,
            status,
            endedAt: at,
            model,
            tokens: sumTokens(e.usage),
            costUsd: cost ?? 0,
            unpriced: cost === undefined,
          }
        }),
      )
      await update($, now, () => at)
    }
    return next(e)
  })

  // ── The launch question, above the prompt ────────────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const kind = await read($, band)
    if (e.props.hasSurvey || kind === 'none') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const choose = async (open: boolean, remember?: Launch) => {
      await update($, band, () => 'none')
      if (remember) await $.store.set(LAUNCH_KEY, remember)
      if (open) await openPanel($)
    }

    // Shown once per install (up to three sessions if ignored), then never again.
    if (kind === 'setup') {
      return (
        <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
          <Text dimColor>Agents panel installed. When should it open?</Text>
          <Button key="s-always" label="Every session" onPress={() => choose(true, 'always')} />
          <Button key="s-sub" label="When a subagent starts" onPress={() => choose(false, 'subagent')} />
          <Button key="s-off" label="Only with /agents-panel" plain onPress={() => choose(false, 'off')} />
        </Box>
      )
    }

    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text dimColor>Open the Agents panel for this session?</Text>
        <Button key="open" label="Open" onPress={() => choose(true)} />
        <Button key="always" label="Always open" onPress={() => choose(true, 'always')} />
        <Button key="later" label="Not now" plain onPress={() => choose(false)} />
      </Box>
    )
  })

  // ── The panel ────────────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const collapsed = await read($, finishedCollapsed)
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), 0)

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()

    const totalCost = list.reduce((s, a) => s + a.costUsd, 0)
    const anyUnpriced = list.some(a => a.unpriced)
    const money = await read($, fx)
    const moneyProblem = await read($, fxProblem)
    const session = await read($, sessionUsd)
    const spend = (usd: number, unpriced: boolean) => fmtSpend(usd, unpriced, money)
    const rateNote =
      money.code === 'USD'
        ? ''
        : money.source === 'manual'
          ? `${money.code} at your rate of ${money.rate}`
          : `${money.code} at the ECB rate of ${money.date || 'an earlier day'}`
    const totalTokens = list.reduce((s, a) => s + a.tokens, 0)
    const totalTime = list.reduce((s, a) => s + elapsed(a, at), 0)

    // Usage by model, most expensive first: where the money went.
    const byModel = [
      ...list
        .reduce((m, a) => {
          const k = info(a.model).label
          const r = m.get(k) ?? { n: 0, tokens: 0, cost: 0, unpriced: false }
          return m.set(k, {
            n: r.n + 1,
            tokens: r.tokens + a.tokens,
            cost: r.cost + a.costUsd,
            unpriced: r.unpriced || a.unpriced,
          })
        }, new Map<string, { n: number; tokens: number; cost: number; unpriced: boolean }>())
        .entries(),
    ].sort((x, y) => y[1].cost - x[1].cost)

    const tile = (label: string, value: string) => (
      <Box key={`t-${label}`} flexDirection="column" flexGrow={1} borderStyle="round" borderDimColor paddingX={1}>
        <Text dimColor size="caption">
          {label}
        </Text>
        <Text weight="semibold" size="heading" mono>
          {value}
        </Text>
      </Box>
    )

    const avatar = (a: AgentRun, fill: number) => {
      if ('Svg' in ui) {
        const { Svg } = ui
        return (
          <Svg
            key={`av-${a.id}-${a.status}`}
            source={avatarSvg({ model: a.model, type: a.type, status: a.status, tokens: a.tokens, fill })}
            alt={`${a.type} chameleon, ${STATUS_TEXT[a.status].label.toLowerCase()}`}
            width={AVATAR_W}
            height={AVATAR_H}
          />
        )
      }
      return <Text color={STATUS_TEXT[a.status].color}>{a.status === 'running' ? '▸' : a.status === 'done' ? '✓' : '✗'}</Text>
    }

    const gauge = (a: AgentRun, fill: number) => {
      if ('Svg' in ui) {
        const { Svg } = ui
        return (
          <Svg
            key={`g-${a.id}`}
            source={gaugeSvg(fill, a.status)}
            alt={`context ${Math.round(fill * 100)} percent full`}
            width={BAR_W}
            height={BAR_H}
          />
        )
      }
      return (
        <Text mono dimColor>
          {textBar(fill)}
        </Text>
      )
    }

    const row = (a: AgentRun) => {
      const fill = a.contextMax ? a.contextTokens / a.contextMax : 0
      const st = STATUS_TEXT[a.status]
      const live = a.status === 'running'
      return (
        <Box key={a.id} flexDirection="row" gap={1} alignItems="flex-start">
          {avatar(a, fill)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box flexDirection="row" justifyContent="space-between" gap={1}>
              <Box flexShrink={1} minWidth={0}>
                <Text weight="semibold" dimColor={!live} wrap="truncate-end">
                  {a.description || a.type}
                </Text>
              </Box>
              {/* The status never shrinks: the title gives way instead. */}
              <Box flexShrink={0}>
                <Text size="caption" color={st.color}>
                  {st.label}
                </Text>
              </Box>
            </Box>
            <Text dimColor size="footnote">
              {a.type} · {info(a.model).label}
              {a.effort ? `, ${a.effort} effort` : ''}
            </Text>
            <Box flexDirection="row" gap={1} alignItems="center">
              {gauge(a, fill)}
              <Text dimColor size="caption" mono>
                {!a.steps && live
                  ? 'starting'
                  : a.contextMax
                    ? `${Math.round(fill * 100)}% of ${fmtTokens(a.contextMax)}`
                    : 'context size unknown'}
              </Text>
            </Box>
            <Text size="footnote" mono dimColor={!live}>
              {spend(a.costUsd, a.unpriced)}  {fmtTokens(a.tokens)} tok  {fmtTime(elapsed(a, at))}  {a.steps} req
            </Text>
          </Box>
        </Box>
      )
    }

    if (list.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text weight="semibold">No subagents yet</Text>
          <Text dimColor>Each subagent this session starts shows up here with its model, context, cost and time.</Text>
          <Text dimColor>Want your own? Run /agents in Claude Code to create one, such as a reviewer or a researcher.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          {tile('Cost', spend(totalCost, anyUnpriced))}
          {tile('Tokens', fmtTokens(totalTokens))}
          {tile('Agent time', fmtTime(totalTime))}
        </Box>

        <Box flexDirection="column">
          {byModel.map(([m, v]) => (
            <Box key={`m-${m}`} flexDirection="row" justifyContent="space-between">
              <Text dimColor size="footnote">
                {m} ×{v.n}
              </Text>
              <Text dimColor size="footnote" mono>
                {fmtTokens(v.tokens)} tok  {spend(v.cost, v.unpriced)}
              </Text>
            </Box>
          ))}
        </Box>

        {session >= 0 && (
          <Text dimColor size="footnote">
            Whole session, from Claude Code: {formatMoney(session, money)}. It includes the main conversation and stays
            right for new models.
          </Text>
        )}
        {(rateNote || moneyProblem) && (
          <Text dimColor size="footnote">
            {moneyProblem || rateNote}
          </Text>
        )}

        {anyUnpriced && (
          <Text dimColor size="footnote">
            + means some models have no price yet. Add yours under "Custom model prices" in /config.
          </Text>
        )}

        {running.length > 0 && (
          <Text weight="semibold" size="footnote">
            Running {running.length}
          </Text>
        )}
        {running.map(row)}

        {finished.length > 0 && (
          <Button
            key="toggle-finished"
            plain
            label={`${collapsed ? '▸' : '▾'} Finished ${finished.length}`}
            onPress={() => update($, finishedCollapsed, v => !v)}
          />
        )}
        {!collapsed && finished.map(row)}
      </Box>
    )
  })
}
