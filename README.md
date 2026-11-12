# Agents panel

A sidebar that shows every subagent Claude starts in your session: what it's doing, which model it runs on, how much of its context it has used, roughly what it costs and how long it has been running. Each agent is drawn as a small pixel chameleon that changes colour as it works.

It's for anyone who wants to see what Claude is running in the background and what it's spending, whether you're a designer, a developer, a subject-matter expert, or part of a small or medium-sized business keeping an eye on spend.

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install agents-panel --marketplace azry92/agents-panel
```

Answer `y` to add the marketplace, then press Enter to install it for your user account (or pick another scope). The panel works from that session on.

From a shell:

```
claude plugin install agents-panel --marketplace azry92/agents-panel
```

In the Claude desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `azry92/agents-panel`, then **Add plugin**.

## What you see

- **Totals:** cost, tokens and agent time for the whole session.
- **Each agent:** its task title, its type, model and effort, a context bar (for example, 42% of 200k), its cost, tokens, time and number of requests.
- **Status:** agents are grouped by whether they're still running or finished.

Costs are estimates, so treat them as a guide, not a bill.

### Your plan usage

**On a Pro or Max plan, the panel shows how much of your usage limits you've used**, at the top, even before any agent runs:

```
Your plan
5-hour   ██████████░░░░  62%  resets in 1h 40m
Weekly   ███░░░░░░░░░░░  18%  resets in 6d 6h
```

- **The bars turn yellow at 75% and red at 90%.** When a window passes 75% and again at 90%, you get a short pop-up, even if the panel is closed. Each warning shows once per window, however many sessions you have open, and comes back after the window resets.
- **Figures update with each of Claude's replies.** After a long break, a window whose reset time has passed shows "reset, updates after your next message" until the next reply.
- **On a plan, costs are labelled "Value":** what the work would cost at list prices. You aren't billed per token, but it still shows which agents did the heavy work.
- **Billed per token (API)?** There are no plan bars, and costs are labelled "Cost", as before. If your gateway has a spend limit, it shows as a "Spend limit" bar, and a figure over 100% means you're past it.

### The chameleons

**Colour shows how full each agent's context is while it works.** Green means plenty of room, then yellow (about 45%), orange (about 65%) and red from 85%. The chameleon also gets slightly darker as it fills, and the exact figure is always next to it, for example "62% of 200k".

**When an agent finishes, its chameleon rests in a soft version of its model's colour:** Opus orange, Sonnet blue, Haiku teal, Fable gold, and grey for any other model. Bright colours always mean "still working". A failed agent turns grey.

**Chameleons grow as their agent uses tokens:** a big-eyed hatchling at first, young from 100k tokens and adult from 500k, each perched on its branch, the adult with a spiral tail.

**While an agent works, its chameleon's eye looks around.** It stops when the agent finishes, and stays still if your computer is set to reduce motion.

**Each agent type wears an accessory:**

| Agent type contains | Wears |
|---|---|
| explore, search, research | a magnifying glass, which sweeps while it works |
| review, audit, check | glasses |
| guide, teach, document | a graduation cap |
| build, setup, fix | a hard hat |
| design, draw, ui | a beret |
| plan, construct, architect | a cap |

Only the first match counts, so `ui-builder` wears the hard hat. Other types, such as `general-purpose`, wear nothing.

## Where it works

The panel works in **Claude Code sessions**: the Code tab in the Claude desktop app, and `claude` in a terminal.

It doesn't show agents from claude.ai chats, claude.ai projects or their threads, even inside the same desktop app. Those run outside Claude Code, so the panel never sees them start. To watch that kind of work in the panel, start it from a Claude Code session in a project folder.

## Opening the panel

Run `/agents-panel` at any time. To choose when it opens by itself, open `/config` in Claude Code in a terminal, search for **Open the Agents panel**, and pick one of these:

| Option | When the panel opens |
|---|---|
| `auto` (default) | Whatever you picked in the first-run question or with `/agents-panel`. If you haven't picked yet, it opens when a subagent starts. |
| `always` | At the start of every session. |
| `subagent` | When the first subagent starts. |
| `ask` | Claude asks you every session. |
| `off` | Only when you run `/agents-panel`. |

## Models and prices

The panel knows Claude's list prices, wherever Claude runs: Anthropic's API, Amazon Bedrock, Google Vertex AI, Microsoft Foundry, or a gateway.

For any other model, such as GPT or Gemini through a gateway like LiteLLM, the panel can't know the price. It shows **price unknown** for that agent and adds a **+** to totals that are missing part of the cost, so a model with no price never looks free.

To add a price, or to use your own negotiated rate in place of a list price, open `/config`, search for **Custom model prices** and enter:

```
gpt-5=1.25/10, gemini-2.5-pro=1.25/10@1m, opus=3/15
```

| Piece | Example | Meaning |
|---|---|---|
| before `=` | `gpt-5` | A model ID, or the start of one. `gpt-5` also covers `gpt-5-mini`. |
| before `/` | `1.25` | Input price, US$ per million tokens |
| after `/` | `10` | Output price, US$ per million tokens |
| after `@` (optional) | `1m`, `400k` | Context window, so the context bar works |

Separate models with commas. When two entries match, the more specific one wins, so `gpt-5=1.25/10, gpt-5-mini=0.25/2` prices mini at its own rate. An entry the panel can't read is skipped and the others still apply.

Cache reads and writes are charged at the input price, so a custom-priced model's cost leans slightly high, never low.

### When new models come out

Per-agent costs come from the price list built into the panel, so a model released after your version of the panel shows **price unknown** until you update the panel or add its price yourself.

Under the totals, the panel also shows **Whole session, from Claude Code**. That figure comes from Claude Code's own cost ledger (the same one `/cost` reads), so it's right for every model, including new ones. It covers the whole session, including your main conversation, so it's usually higher than the agents' total.

## Your currency

Costs are in US dollars by default. To see them in your own currency, open `/config`, search for **Currency** and enter a three-letter code, such as `MYR`, `SGD`, `EUR` or `JPY`.

- **Rates update once a day** from the European Central Bank's reference rates, through [frankfurter.dev](https://frankfurter.dev). The request carries only the currency code, and with `USD` no request is made at all.
- **Under the totals**, the panel shows which rate it used and the rate's date.
- **If the rate can't be fetched** (offline, blocked by your organization, or a currency the ECB doesn't publish, such as VND or AED), the panel uses your **Fallback exchange rate** from `/config`, then the last rate it fetched, and otherwise shows US dollars with a note saying so.

The ECB publishes rates for 30 currencies, including MYR, SGD, IDR, PHP, THB, INR, CNY, JPY, KRW, HKD, AUD, NZD, GBP and EUR.

## Make your own agents

The panel shows any subagent, including your own. To create one, run `/agents` in Claude Code and describe what you want, such as "a reviewer that checks my designs for accessibility". Claude writes the agent for you.

- **Personal agents** are saved in `~/.claude/agents/`. They're yours, work in every project and stay on your machine.
- **Project agents** are saved in a project's `.claude/agents/` folder and are shared with everyone who works on that project.

The panel shows your agent's name beside its chameleon, and a name with a word like "review" or "research" in it gets the matching accessory, so you can tell your reviewer from your researcher at a glance.

This plugin doesn't come with any agents, so you only get the ones you make or choose to install.

## License

MIT. See [LICENSE](LICENSE).