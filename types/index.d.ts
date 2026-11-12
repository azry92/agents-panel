export type AgentStatus = 'running' | 'done' | 'failed'

/** The rate the panel converts US-dollar estimates with: 1 USD = `rate` of `code`. */
export type Fx = {
  code: string
  rate: number
  /** live: fetched today. cached: an older fetch. manual: typed in /config. */
  source: 'live' | 'cached' | 'manual'
  /** The rate's own date, for live and cached rates. */
  date?: string
}

export type AgentRun = {
  /** agentId when the engine gives one, else the Agent tool call's id. */
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  /** Reasoning effort of the latest request, when the engine reports one. */
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  /** Tokens in the latest request: how full the context window is. */
  contextTokens: number
  contextMax: number
  /** All tokens across the run's requests. */
  tokens: number
  /** Sum of the requests the panel could price. */
  costUsd: number
  /** True once any request used a model with no price: costUsd is then a floor, not the whole cost. */
  unpriced: boolean
  steps: number
}

declare module 'claude-code' {
  interface PluginState {
    'agents-panel': {
      agents: Shaped<AgentRun[]>
      now: number
      autoOpened: boolean
      finishedCollapsed: boolean
      band: 'none' | 'setup' | 'ask'
      /** The currency amounts are shown in. */
      fx: Fx
      /** Why the chosen currency's rate couldn't be had, shown under the totals; '' when fine. */
      fxProblem: string
      /** Claude Code's own cost for the whole session, in US$; -1 until it reports one. */
      sessionUsd: number
    }
  }
}
