---
name: cc-tokenomics
description: >-
  Analyzes Claude Code token usage, cache hit rates, and Max plan consumption.
  Presents a compact dashboard with plan-usage bars, session token breakdown,
  context growth, and 2-3 actionable insights about cache behavior, burn rate,
  and cost efficiency.
when_to_use: >-
  Use when the user asks about "tokens", "usage", "cache", "plan limit",
  "how much quota is left", "am I going to hit the limit", "cache stats",
  "show my usage", or types "/cc-tokenomics". Also triggers on questions about
  session efficiency, context growth, cost per session, or worry about a
  long session burning quota. For abstract questions about how Claude Code
  billing works (not measuring the current session), surface the reference
  files instead.
argument-hint: "[--all | <session.jsonl path>]"
arguments: target
allowed-tools:
  - Bash(python3 *)
  - Bash(security find-generic-password *)
---

# Tokenomics — Token & Plan Usage Analysis

Analyze token use, cache efficiency, and plan consumption for Claude Code sessions.

## Invocation

- `/cc-tokenomics` — current session
- `/cc-tokenomics --all` — aggregate across every session on disk
- `/cc-tokenomics <path-to-session.jsonl>` — specific transcript

## Live data

The report script pre-runs at invocation; the numbers below arrive before the skill content does, so the dashboard renders in a single turn.

```!
python3 "${CLAUDE_SKILL_DIR}/scripts/token-report.py" $ARGUMENTS
```

Current timestamp: !`date +"%Y-%m-%d %H:%M"`

## Dashboard format

Render the pre-computed numbers in this exact shape:

```
━━━ Tokenomics — 2026-04-08 10:15 ━━━

PLAN USAGE
  5h   ██████░░░░░░░░░░░░░░  28%   resets in 3h10m
  7d   █████████░░░░░░░░░░░  49%   resets in 61h10m

SESSION TOKENS
  Cache Read    75.7M  (98.8% hit rate)
  Cache Write  916.9k
  Input          4.8k
  Output       102.9k
  Total In      77.3M
  Context       43.4% of 1M

EXTRA USAGE
  $34.79 / $550.00 (6.3%)
  █░░░░░░░░░░░░░░░░░░░
```

Progress bars are 20 chars wide, `█` and `░`. Plan usage goes first — it's what the user cares about most.

## Insights

After the dashboard, add 2-3 short insights drawn from the actual numbers. Pick only ones that are interesting given this session — don't list all four categories if only one is notable. One line each. ultrathink about which 2-3 matter most given the numbers above.

**Cache behavior examples:**
- "Cache hit rate is 98.8% — essentially optimal. System prompt and context are fully cached between turns."
- "Cache hit dropped to 72% — likely a gap longer than TTL, which evicted the cache. The next few turns will re-cache."
- "Cache write tokens (916k) are high relative to reads — many cache invalidations, likely from editing CLAUDE.md or switching contexts."

**Burn rate examples:**
- "At current pace (28% in ~2h), you'll use the 5h window in ~3.5 more hours of active work."
- "7d window is at 49% with 61h until reset — plenty of headroom."
- "You've used 28% of your 5h window. If you're done for now, it resets in 3h10m."

**Context growth examples:**
- "Context is at 43% of 1M — conversation is still compact."
- "Context is at 75% — approaching auto-compaction. Consider /clear if switching tasks."

**Cost efficiency examples:**
- "98.8% cache hit means almost every token is served from cache — both cheap and quota-friendly."
- "Extra usage is at $34.79 — at this rate you'll use ~$120 this month."

## Trend (when --all or multiple data points)

When showing all sessions or the user asks about trends, add a simple ASCII sparkline of cache hit rates or plan use across sessions:

```
Cache hit trend (last 5 sessions):
  92% → 95% → 98% → 97% → 98%  ▁▃█▆█
```

## Additional resources

- Token economics deep-dive (three token types, cache lifecycle, TTL, 5h/7d windows, optimization): [reference/economics.md](reference/economics.md)
- Empirical test lab (verified + pending): [reference/experiments.md](reference/experiments.md)
- Cache keepalive (separate `cc-cache-keepalive` plugin): [reference/keepalive.md](reference/keepalive.md)
