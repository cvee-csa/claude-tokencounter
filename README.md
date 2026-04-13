# Claude Token Counter & Optimizer

A team tool for counting tokens in Claude API prompts and getting actionable suggestions to reduce token usage and costs.

## Features

- **Token Counting** — Quick local estimates or exact counts via the Anthropic API
- **Model Cost Comparison** — Side-by-side pricing across Opus 4.6, Sonnet 4.6, and Haiku 4.5 (standard + Batch API)
- **Token Optimizer** — Analyzes prompts for 10 common token-wasting patterns and provides specific fix suggestions
- **Scale Estimator** — Project daily/monthly costs based on expected request volume

## Optimization Rules

The optimizer detects:

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

## Setup

### Quick Estimate Mode (no setup)

Open `token-counter.jsx` in any React-compatible environment. Paste a prompt and click **Estimate Tokens**.

### Exact Count Mode (requires API key)

The Anthropic API doesn't allow direct browser calls (CORS), so a lightweight local proxy is included.

```bash
# Install the one dependency
npm install express

# Start the proxy server
node server.js
```

The proxy runs on `localhost:3456` and forwards requests to Anthropic's `/v1/messages/count_tokens` endpoint. Your API key is sent per-request and never stored.

## Files

| File | Description |
|------|-------------|
| `token-counter.jsx` | React app — token counter, cost comparison, and optimizer UI |
| `server.js` | Express proxy server for Anthropic API calls |

## Pricing Reference

Based on [Anthropic's official pricing](https://platform.claude.com/docs/en/about-claude/pricing) (April 2026):

| Model | Input | Output | Batch Input | Batch Output |
|-------|-------|--------|-------------|--------------|
| Opus 4.6 | $5/MTok | $25/MTok | $2.50/MTok | $12.50/MTok |
| Sonnet 4.6 | $3/MTok | $15/MTok | $1.50/MTok | $7.50/MTok |
| Haiku 4.5 | $1/MTok | $5/MTok | $0.50/MTok | $2.50/MTok |

## License

Internal team tool — Cloud Security Alliance.
