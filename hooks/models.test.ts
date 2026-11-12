import { expect, test } from 'claude-code/testing'
import type { ModelUsage } from 'claude-code'

import { coreId, costOf, modelInfo, parsePriceOverrides } from './models'

const usage = (u: Partial<ModelUsage>): ModelUsage =>
  ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...u }) as ModelUsage

/** Rounds away floating-point noise; this test kit has no toBeCloseTo. */
const usd = (n: number | undefined) => (n === undefined ? n : Math.round(n * 1e7) / 1e7)

test('every provider wrapping comes off a Claude model ID', async () => {
  expect(coreId('claude-opus-5-5')).toBe('opus-5-5')
  expect(coreId('claude-opus-5-5[1m]')).toBe('opus-5-5')
  expect(coreId('us.anthropic.claude-opus-5-5-v1:0')).toBe('opus-5-5')
  expect(coreId('global.anthropic.claude-sonnet-5-5-v1:0')).toBe('sonnet-5-5')
  expect(coreId('claude-sonnet-5-5@20261001')).toBe('sonnet-5-5')
  expect(coreId('anthropic/claude-haiku-5-5')).toBe('haiku-5-5')
  expect(coreId('claude-haiku-5-5-20261001')).toBe('haiku-5-5')
})

test('a non-Claude ID keeps its own name', async () => {
  expect(coreId('openai/gpt-5-mini')).toBe('gpt-5-mini')
  expect(coreId('gemini-2.5-pro')).toBe('gemini-2.5-pro')
})

test('Claude on any provider gets the same label, window and price', async () => {
  for (const id of ['claude-opus-5-5', 'us.anthropic.claude-opus-5-5-v1:0', 'claude-opus-5-5@20261001']) {
    const info = modelInfo(id)
    expect(info.label).toBe('Opus 5.5')
    expect(info.window).toBe(200_000)
    expect(info.prices?.input).toBe(4)
  }
  expect(modelInfo('claude-opus-5-5[1m]')).toMatchObject({ label: 'Opus 5.5 1M', window: 1_000_000 })
})

test('an unknown model has no price and no window, not a price of zero', async () => {
  const info = modelInfo('openai/gpt-5-mini')
  expect(info.label).toBe('gpt-5-mini')
  expect(info.window).toBeUndefined()
  expect(costOf(info, usage({ input_tokens: 1_000_000 }))).toBeUndefined()
})

test('a custom price prices an unknown model, and beats a list price', async () => {
  const overrides = { gpt: { prices: { input: 1, cacheWrite: 1, cacheHit: 0.1, output: 8 }, window: 400_000 } }
  const gpt = modelInfo('openai/gpt-5-mini', overrides)
  expect(gpt.window).toBe(400_000)
  expect(costOf(gpt, usage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }))).toBe(9)

  const opus = modelInfo('claude-opus-5-5', { opus: { prices: { input: 1, cacheWrite: 1, cacheHit: 1, output: 1 } } })
  expect(opus.prices?.input).toBe(1)
})

test('the longest matching custom key wins', async () => {
  const p = (input: number) => ({ prices: { input, cacheWrite: 0, cacheHit: 0, output: 0 } })
  expect(modelInfo('gpt-5-mini', { 'gpt-5': p(2), 'gpt-5-mini': p(1) }).prices?.input).toBe(1)
})

test('cost adds each kind of token at its own rate', async () => {
  const opus = modelInfo('claude-opus-5-5')
  const c = costOf(opus, usage({ input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000 }))
  expect(usd(c)).toBe(6.2)
})

// Real usage from one session's transcripts: two Opus 5.5 subagents (5-minute
// cache writes only) and the main conversation (1-hour cache writes only).
// The panel once showed the agents at $1.33 and $0.74 by charging every write
// at the 1-hour rate; Claude Code's own total for the whole session was $2.04.
test('subagent cache writes are priced at the 5-minute rate', async () => {
  const opus = modelInfo('claude-opus-5-5')
  const repo = usage({ input_tokens: 24, output_tokens: 6095, cache_read_input_tokens: 1_159_276, cache_creation_input_tokens: 121_879 })
  const setup = usage({ input_tokens: 10, output_tokens: 3108, cache_read_input_tokens: 281_829, cache_creation_input_tokens: 78_195 })
  expect(usd(costOf(opus, repo))).toBe(0.9632462)
  expect(usd(costOf(opus, setup))).toBe(0.5095408)
})

test('cache writes the usage marks as 1-hour are priced at the 1-hour rate', async () => {
  const opus = modelInfo('claude-opus-5-5')
  const main = {
    ...usage({ input_tokens: 12, output_tokens: 3138, cache_read_input_tokens: 586_585, cache_creation_input_tokens: 65_860 }),
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 65_860 },
  }
  expect(usd(costOf(opus, main))).toBe(0.707005)

  // A mixed request: each part at its own rate.
  const mixed = { ...usage({ cache_creation_input_tokens: 2_000_000 }), cache_creation: { ephemeral_1h_input_tokens: 1_000_000 } }
  expect(usd(costOf(opus, mixed))).toBe(5 + 8)
})

test('a custom price with no 1-hour rate uses its one write rate for both', async () => {
  const gpt = modelInfo('gpt-5', parsePriceOverrides('gpt-5=1/10'))
  const u = { ...usage({ cache_creation_input_tokens: 2_000_000 }), cache_creation: { ephemeral_1h_input_tokens: 1_000_000 } }
  expect(usd(costOf(gpt, u))).toBe(2)
})

test('Haiku moves to its long-prompt rate past 100k tokens', async () => {
  const haiku = modelInfo('claude-haiku-5-5')
  expect(usd(costOf(haiku, usage({ input_tokens: 100_000 })))).toBe(0.01)
  expect(usd(costOf(haiku, usage({ input_tokens: 100_001 })))).toBe(0.0500005)
})

test('no custom prices set means no overrides', async () => {
  expect(parsePriceOverrides('')).toEqual({})
  expect(parsePriceOverrides('   ')).toEqual({})
})

test('the README example parses entry by entry', async () => {
  expect(parsePriceOverrides('gpt-5=1.25/10, gemini-2.5-pro=1.25/10@1m, opus=3/15')).toEqual({
    'gpt-5': { prices: { input: 1.25, cacheWrite: 1.25, cacheHit: 1.25, output: 10 } },
    'gemini-2.5-pro': { prices: { input: 1.25, cacheWrite: 1.25, cacheHit: 1.25, output: 10 }, window: 1_000_000 },
    opus: { prices: { input: 3, cacheWrite: 3, cacheHit: 3, output: 15 } },
  })
})

test('sizes, spaces, capitals, dollar signs and full model IDs are all understood', async () => {
  const o = parsePriceOverrides(' GPT-5 = $1.25 / $10 @ 400K , anthropic/claude-sonnet-5-5=2/10@128000 ')
  expect(o['gpt-5']).toEqual({ prices: { input: 1.25, cacheWrite: 1.25, cacheHit: 1.25, output: 10 }, window: 400_000 })
  expect(o['sonnet-5-5']?.window).toBe(128_000)
})

test('a bad entry is skipped and the others still apply', async () => {
  const o = parsePriceOverrides(
    'gpt-5=1.25/10, typo-no-equals 1/2, =1/2, bad=abc/10, neg=-1/10, half=1, extra=1/2/3, nosize=1/2@, odd=1/2@lots',
  )
  expect(Object.keys(o)).toEqual(['gpt-5'])
})

test('a parsed price drives the cost and the context bar', async () => {
  const gpt = modelInfo('openai/gpt-5-mini', parsePriceOverrides('gpt-5=1.25/10@400k'))
  expect(gpt.window).toBe(400_000)
  expect(costOf(gpt, usage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }))).toBe(11.25)
})
