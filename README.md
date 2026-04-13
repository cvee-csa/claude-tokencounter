# Claude Token Counter & Optimizer

A team tool for counting tokens in Claude API prompts and getting actionable suggestions to reduce token usage and costs.

## Quick Start

```bash
# One-time setup
npm install express

# Start the server
node server.js
```

Then open **http://localhost:3456** in your browser. That's it.

Quick Estimate mode works immediately — no API key needed. For Exact Count mode, you have three options for providing your API key (pick whichever is easiest):

### Option 1: Environment variable (recommended for individuals)
```bash
export ANTHROPIC_API_KEY=sk-ant-...
node server.js
```

### Option 2: `.env` file (recommended for teams)
Create a `.env` file in the project folder:
```
ANTHROPIC_API_KEY=sk-ant-...
```
Then just run `node server.js` — the key is loaded automatically. The `.env` file is git-ignored so it won't be committed.

### Option 3: Paste in the browser
Switch to "Exact Count (API)" and paste your key. The browser remembers it locally so you only need to do this once.

You can also open `token-counter.html` directly in a browser (double-click the file) for Quick Estimate mode without running the server.

## Features

- **Token Counting** — Quick local estimates or exact counts via the Anthropic `/v1/messages/count_tokens` endpoint
- **Model Cost Comparison** — Side-by-side pricing across Opus 4.6, Sonnet 4.6, and Haiku 4.5 (standard + Batch API)
- **Token Optimizer** — Analyzes prompts for 10 common token-wasting patterns and provides specific fix suggestions with estimated savings
- **Scale Estimator** — Project daily/monthly costs based on expected request volume
- **Built-in Caveats** — Inline warnings about estimate accuracy, hidden overhead, and pricing limitations so your team makes informed decisions

## What the Optimizer Detects

- Instructions that should be moved to a cacheable system prompt
- Prompt caching opportunities (90% savings on repeat content)
- Repeated sentences and verbose filler phrases
- Excessive examples (2-3 is usually enough for Claude)
- Large pasted documents that could be pre-processed
- Unnecessary whitespace
- Tasks suited for a smaller, cheaper model
- Missing output length constraints
- Verbose XML tag names
- Batch API opportunities (50% off)

## Files

| File | Description |
|------|-------------|
| `token-counter.html` | Self-contained app — just open in a browser |
| `server.js` | Serves the app and proxies API requests to Anthropic |
| `.env` | (You create this) Your API key — git-ignored, never committed |
| `.gitignore` | Keeps `.env` and `node_modules` out of the repo |
| `token-counter.jsx` | React version (requires React tooling) |

## Pricing Reference

Based on [Anthropic's official pricing](https://platform.claude.com/docs/en/about-claude/pricing) (April 2026):

| Model | Input | Output | Batch Input | Batch Output |
|-------|-------|--------|-------------|--------------|
| Opus 4.6 | $5/MTok | $25/MTok | $2.50/MTok | $12.50/MTok |
| Sonnet 4.6 | $3/MTok | $15/MTok | $1.50/MTok | $7.50/MTok |
| Haiku 4.5 | $1/MTok | $5/MTok | $0.50/MTok | $2.50/MTok |

## Important Caveats

These are also displayed in the app itself, but worth noting here:

1. **Local estimates are approximate** — the heuristic works well for English prose but is less accurate for code, non-Latin scripts, and structured formats like JSON/XML
2. **Output tokens are unpredictable** — the API only counts input tokens; the output slider is a manual guess
3. **Hidden system tokens aren't counted** — tool definitions add 300-700+ tokens per request that don't appear in your prompt
4. **Caching savings require implementation** — the optimizer identifies opportunities, but you need to implement `cache_control` in your API calls
5. **Pricing is hardcoded** — rates reflect April 2026 and need manual updates if Anthropic changes pricing
6. **Costs are a lower bound** — real bills include output tokens, tool overhead, images, and web search charges

## License

Internal team tool — Cloud Security Alliance.
