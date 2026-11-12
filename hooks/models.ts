import type { ModelUsage } from 'claude-code'

// Everything the panel knows about a model ID lives here: its display name,
// its context window and its price. One place to read the ID, so Claude on
// Bedrock, Vertex or Foundry and non-Claude models through a gateway all go
// through the same rules.

/** US dollars per million tokens. */
export type Prices = {
  input: number
  /** 5-minute cache write (1.25 × input on Claude): what subagents use. */
  cacheWrite: number
  /** 1-hour cache write (2 × input on Claude); cacheWrite when absent. */
  cacheWrite1h?: number
  cacheHit: number
  output: number
  /** A higher tier once one request's prompt passes `above` tokens. */
  long?: { above: number; prices: Omit<Prices, 'long'> }
}

/** A price the person entered in /config, for a model ID or the start of one. */
export type Override = { prices: Prices; window?: number }
export type Overrides = Record<string, Override>

export type ModelInfo = {
  /** "Opus 5.5 1M", or a non-Claude ID as it is, such as "gpt-5-mini". */
  label: string
  /** Context window in tokens; undefined when the panel can't know it. */
  window?: number
  /** Undefined when nothing prices this model: the panel shows "price unknown". */
  prices?: Prices
}

// List prices for Claude, by family. An estimate, not a bill.
// Cache writes: 5 minutes at 1.25 × input, 1 hour at 2 × input.
const CLAUDE: Record<string, Prices> = {
  fable: { input: 8, cacheWrite: 10, cacheWrite1h: 16, cacheHit: 0.2, output: 40 },
  opus: { input: 4, cacheWrite: 5, cacheWrite1h: 8, cacheHit: 0.2, output: 20 },
  sonnet: { input: 2, cacheWrite: 2.5, cacheWrite1h: 4, cacheHit: 0.1, output: 10 },
  haiku: {
    input: 0.1,
    cacheWrite: 0.125,
    cacheWrite1h: 0.2,
    cacheHit: 0.01,
    output: 0.5,
    long: { above: 100_000, prices: { input: 0.5, cacheWrite: 0.625, cacheWrite1h: 1, cacheHit: 0.05, output: 2.5 } },
  },
}

/**
 * Usage as the API reports it can split cache writes by lifetime. The engine's
 * ModelUsage type doesn't promise the split, so it's read only when present.
 */
type CacheSplit = { cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } }

/**
 * The model's own name with every provider's wrapping removed, lowercased.
 *   "claude-opus-5-5[1m]"                 → "opus-5-5"
 *   "us.anthropic.claude-opus-5-5-v1:0"   → "opus-5-5"   (Bedrock)
 *   "claude-sonnet-5-5@20261001"          → "sonnet-5-5" (Vertex)
 *   "anthropic/claude-haiku-5-5"          → "haiku-5-5"  (gateway)
 *   "openai/gpt-5-mini"                   → "gpt-5-mini"
 */
export function coreId(id: string): string {
  return id
    .toLowerCase()
    .replace(/\[1m\]$/, '')
    .replace(/^.*\//, '') // gateway prefix: "openai/", "anthropic/"
    .replace(/^(us|eu|apac|global|jp|au)\./, '') // Bedrock cross-region prefix
    .replace(/^anthropic\./, '') // Bedrock vendor prefix
    .replace(/@.*$/, '') // Vertex version: "@20261001"
    .replace(/-v\d+(:\d+)?$/, '') // Bedrock version: "-v1:0"
    .replace(/-\d{8}$/, '') // dated snapshot
    .replace(/^claude-/, '')
}

/** The override for this model: an exact key, else the longest key it starts with. */
const overrideFor = (core: string, overrides: Overrides): Override | undefined => {
  const key = Object.keys(overrides)
    .filter(k => core === k || core.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return key === undefined ? undefined : overrides[key]
}

export function modelInfo(id: string, overrides: Overrides = {}): ModelInfo {
  const long = /\[1m\]$/i.test(id)
  const core = coreId(id)
  const [family = '', ...ver] = core.split('-')
  const claude = CLAUDE[family]
  const custom = overrideFor(core, overrides)

  const label = claude
    ? `${family.charAt(0).toUpperCase()}${family.slice(1)}${ver.length ? ` ${ver.join('.')}` : ''}${long ? ' 1M' : ''}`
    : core || id
  return {
    label,
    window: custom?.window ?? (claude ? (long ? 1_000_000 : 200_000) : undefined),
    // A person's own rate beats the list price.
    prices: custom?.prices ?? claude,
  }
}

/** Estimated USD for one request, or undefined when the model has no price. */
export function costOf(info: ModelInfo, usage: ModelUsage): number | undefined {
  if (!info.prices) return undefined
  const prompt = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  const p = info.prices.long && prompt > info.prices.long.above ? info.prices.long.prices : info.prices
  // Writes are 5-minute unless the usage says some were 1-hour: subagents use
  // 5-minute caching, so pricing every write at the 1-hour rate overcharges.
  const written = usage.cache_creation_input_tokens
  const hour = Math.min(written, (usage as ModelUsage & CacheSplit).cache_creation?.ephemeral_1h_input_tokens ?? 0)
  return (
    usage.input_tokens * p.input +
    (written - hour) * p.cacheWrite +
    hour * (p.cacheWrite1h ?? p.cacheWrite) +
    usage.cache_read_input_tokens * p.cacheHit +
    usage.output_tokens * p.output
  ) / 1_000_000
}

/** "400k" → 400_000, "1m" → 1_000_000, "128000" → 128_000; undefined if it isn't a size. */
const parseSize = (s: string): number | undefined => {
  const m = /^(\d+(?:\.\d+)?)\s*([km]?)$/i.exec(s.trim())
  if (!m) return undefined
  const n = Number(m[1]) * ({ k: 1_000, m: 1_000_000 }[m[2]!.toLowerCase()] ?? 1)
  return n > 0 ? Math.round(n) : undefined
}

/** A price: a finite number, zero or more. */
const parsePrice = (s: string): number | undefined => {
  const t = s.trim().replace(/^\$/, '')
  const n = Number(t)
  return t !== '' && Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * Reads the "Custom model prices" option from /config into overrides.
 *
 *   "gpt-5=1.25/10, gemini-2.5-pro=1.25/10@1m, opus=3/15"
 *
 * Each comma-separated entry is `model=input/output`, US$ per million tokens,
 * with an optional `@size` context window (`400k`, `1m`). The model is an ID or
 * the start of one, matched against coreId(). Cache reads and writes (both
 * lifetimes) are priced at the input rate: an estimate, leaning high on reads.
 *
 * An entry that doesn't parse is skipped and the rest still apply: one typo
 * mustn't stop the panel loading or wipe out every other price.
 */
export function parsePriceOverrides(text: string): Overrides {
  const overrides: Overrides = {}
  for (const entry of text.split(',')) {
    const eq = entry.indexOf('=')
    if (eq < 0) continue
    const key = coreId(entry.slice(0, eq).trim())
    const [rates = '', size] = entry.slice(eq + 1).split('@')
    const [inStr = '', outStr = '', ...extra] = rates.split('/')
    const input = parsePrice(inStr)
    const output = parsePrice(outStr)
    const window = size === undefined ? undefined : parseSize(size)
    // Skip anything malformed: no key, a missing or bad price, a stray "/", or an "@" with no size.
    if (!key || input === undefined || output === undefined || extra.length || (size !== undefined && !window)) continue
    overrides[key] = {
      prices: { input, cacheWrite: input, cacheHit: input, output },
      ...(window ? { window } : {}),
    }
  }
  return overrides
}
