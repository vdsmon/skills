---
name: tokenomics
description: Analyze Claude Code token usage, cache hit rates, and Max plan consumption. Use when the user asks about their usage, tokens, cache behavior, costs, plan limits, how much quota is left, "tokenomics", or wants to understand how efficiently their session is using the context window. Also triggers on questions like "how much have I used", "am I going to hit the limit", "cache stats", or "show my usage".
user-invocable: true
---

# Tokenomics — Token & Plan Usage Analysis

Analyze token use, cache efficiency, plan use for Claude Code sessions.

## Step 1: Collect Data

Run bundled script:

```bash
python3 /Users/victordsm/repos/personal/claude-skills/plugins/tokenomics/skills/tokenomics/scripts/token-report.py
```

Options: `--all` for all sessions, or pass specific `.jsonl` path.

Script output raw numbers: per-turn token breakdown, totals, cache ratio, live plan use from Anthropic API.

## Step 2: Present as a Dashboard

Parse script output. Present as compact visual dashboard. Include current date/time.

### Format

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

Progress bars: 20 chars wide, █ and ░. Plan use first — user care most.

## Step 3: Add Insights

After dashboard, add 2-3 short insights from data. Think what interesting or actionable. Example analysis:

**Cache behavior:**
- "Cache hit rate is 98.8% — essentially optimal. Your system prompt and context are being fully cached between turns."
- "Cache hit dropped to 72% — you likely had a gap longer than 5 minutes, which evicted the cache. The next few turns will re-cache."
- "Cache write tokens (916k) are high relative to reads — this session had many cache invalidations, likely from editing CLAUDE.md or switching contexts."

**Burn rate:**
- "At current pace (28% in ~2h), you'll use the 5h window in ~3.5 more hours of active work."
- "7d window is at 49% with 61h until reset — plenty of headroom."
- "You've used 28% of your 5h window. If you're done for now, it resets in 3h10m."

**Context growth:**
- "Context is at 43% of 1M — conversation is still compact."
- "Context is at 75% — approaching auto-compaction. Consider /clear if switching tasks."

**Cost efficiency:**
- "98.8% cache hit means almost every token is served from cache — both cheap and quota-friendly."
- "Extra usage is at $34.79 — at this rate you'll use ~$120 this month."

Pick insights relevant to actual numbers. No repeat all — only 2-3 that matter given current data. One line each.

## Step 4: Trend (if --all or multiple data points)

When showing all sessions or user ask about trends, show simple ASCII sparkline of cache hit rates or plan use across sessions:

```
Cache hit trend (last 5 sessions):
  92% → 95% → 98% → 97% → 98%  ▁▃█▆█
```

## Token Economics Reference

Section document how Claude Code token billing and rate limits work. From official Anthropic docs + empirical testing.

### The Three Token Types

Every API call produce three categories of input tokens:

| Type | What it is | Counts toward ITPM rate limit? | Counts toward Max plan quota? | Cost (API) |
|------|-----------|-------------------------------|------------------------------|------------|
| `input_tokens` | Uncached tokens after the last cache breakpoint | **YES** | **YES** | Full price |
| `cache_creation_input_tokens` | Tokens being written to cache for the first time | **YES** | **YES** | 125% of input price |
| `cache_read_input_tokens` | Tokens served from prompt cache | **NO** (for Opus 4.x, Sonnet 4.x, Haiku 4.5) | **NO** (empirically confirmed) | 10% of input price |

**Source**: [Anthropic Rate Limits docs](https://platform.claude.com/docs/en/api/rate-limits) — "For most Claude models, only uncached input tokens count towards your ITPM rate limits."

**Note**: Old models (Haiku 3, Haiku 3.5, marked † in Anthropic tables) DO count cache reads toward ITPM. Current models (Opus 4.x, Sonnet 4.x, Haiku 4.5) do NOT.

### What This Means for Max Plan Users

Cache reads **free every dimension** — cheap dollars (10% rate) AND free toward quota. Confirmed empirically:

- **Experiment**: 20+ rapid ping/pong turns at ~435k context (98%+ cache reads) → plan usage did NOT move
- **Counter-experiment**: 15 file reads injecting new content → plan usage spiked from 0% to 41%
- **Conclusion**: only `input_tokens` + `cache_creation_input_tokens` consume quota. Cache reads are free.

### What Consumes Quota (and what doesn't)

**Expensive (burns quota fast):**
- **Resuming a session** (`claude --resume`) — full cache rebuild, zero cache hits on first message. Claude Code warns: "tokens will be rebuilt from scratch (no cache)". In testing, each resume cost ~410k cache_creation tokens and ~10% of the 5h window.
- **Switching models and sending a message** (`/model`) — caches model-isolated. Sending msg on different model then switching back force full cache rebuild on original model. Empirical: Opus→Sonnet(msg)→Opus dropped cache to 2.1%, burned 11% of 5h window. Note: even failed message (context limit exceeded) counts. Whether toggling `/model` without sending msg kills cache **unverified** (pending test #6).
- Read new files (each file content = cache_creation tokens on first read)
- Edit CLAUDE.md or system prompt (invalidates entire cached prefix, forces re-creation)
- Start new session (full cache creation on first message)
- Long idle gaps beyond cache TTL (1h Max, 5m Pro) — next message re-creates everything
- Spawn subagents (each gets own context window + cache)

**Cheap (barely moves quota):**
- Normal conversation after first few turns (almost all cache reads)
- Short messages back and forth (small output tokens, cache reads dominate)
- Tool calls returning small results (grep, ls, etc.)
- /tokenomics report itself (~500 tokens per run)

**Free (zero quota impact):**
- Idle time (no API calls = no tokens)
- Status line updates (client-side)
- Read files already in context (dedup by harness)

### Cache Lifecycle

1. **First message**: Full cache creation (~20-50k tokens for system prompt + CLAUDE.md + skills). Expensive.
2. **Subsequent messages**: Cache reads for prefix + small cache creation for new conversation turns. Cheap.
3. **Cache expires**: Next message re-creates everything. Expensive.
4. **Editing CLAUDE.md**: Invalidates prefix cache. Next message re-creates from scratch.
5. **Auto-compaction**: Context near limit → older messages summarized. Creates new cache entries but reduces total context size.
6. **Resume (`claude --resume`)**: Reconstructs conversation from JSONL transcript. Different token sequence than original → **entire cache invalidated**. First message after resume has 0% cache hit rate, pays full cache_creation cost. Claude Code warns: "tokens will be rebuilt from scratch (no cache). Consider /clear for a cheaper fresh start."

### Cache TTL by Plan

| Plan | Cache TTL | Cache write cost | Keepalive strategy |
|------|-----------|-----------------|-------------------|
| **Max** | **1 hour** | 2x base input price | `/loop every 30m` — only viable interval. 60-min **does not work** (TTL + jitter = consistent misses, verified test #5b). Intermediate values like 45-min can't express in cron (only divisors of 60 work: 1,2,3,4,5,6,10,12,15,20,30). So 30 or bust. |
| **Pro** | 5 minutes | 1.25x base input price | Need ~3-4 min loop (aggressive) |
| **API** | 5 minutes | 1.25x base input price | Implement in application logic |

Max plan 1h TTL massive advantage — 50-min break, cache survive. On Pro, 6-min pause kills cache, trigger full rebuild.

**Cache keepalive loop**: `/loop every 30m: /tokenomics` dual purpose — monitor AND keep cache warm. Each loop iteration = API call that resets 1h TTL. Without it, idle >1h triggers full cache rebuild costing hundreds of thousands cache_creation tokens.

### The 5-Hour Window

- Rolling window, starts when first message sent (floored to hour)
- Counts `input_tokens` + `cache_creation_input_tokens` (NOT cache reads)
- Resets fully when window expires
- **Warmup trick**: Send minimal message early (e.g., via [claude-warmup](https://github.com/vdsmon/claude-warmup)) to anchor window reset at convenient time

### The 7-Day Window

- Weekly rolling quota, separate from 5h window
- Same count rules as 5h (cache reads no count)
- Max 5x plan = 5x Pro quota; Max 20x = 20x

### Optimization Strategies

1. **Keep the cache alive, never resume** — Max plan, cache live 1 hour. `/loop every 30m` keep warm forever. Keepalive cost negligible: each poll ~26k input tokens but 99%+ cache reads (~200 uncached tokens per poll). Over 120+ iterations at 1-min intervals, plan use barely moved. At 30-min intervals, session run days without meaningful quota impact. **Never quit and resume** — resume invalidates entire cache (confirmed: 0% hit rate, full rebuild ~410k cache_creation tokens, ~10% of 5h window per resume). Must leave → keep session running. Session dies → `/clear` and start fresh cheaper than resuming large conversation.
2. **Avoid bulk file reads** — Each new file = cache_creation tokens. Use targeted reads (specific lines) instead of reading whole files.
3. **Don't edit CLAUDE.md mid-session** — Invalidates entire cache prefix. Edit between sessions if possible.
4. **Use /clear wisely** — Clears context, next message re-creates cache. Good for task switch, expensive if continuing same work.
5. **Never switch models mid-session** (`/model`) — caches model-isolated. Even toggle back to same model destroys cache. Empirical: cost 11% of 5h window in one turn. Need different model → use subagent or separate session.
6. **Anchor your 5h window** — Use warmup trick to schedule resets at convenient times.
7. **Delegate verbose operations to subagents** — Output stay in subagent context, not yours.
8. **Keep CLAUDE.md lean** — Every token in CLAUDE.md re-cached on every prefix invalidation. 200 lines max.

## Data Sources

- **Token data**: session transcripts at `~/.claude/projects/<project>/*.jsonl`
- **Plan usage**: live from `https://api.anthropic.com/api/oauth/usage` (OAuth token from macOS Keychain, requires `anthropic-beta: oauth-2025-04-20` header)
- **Rate limit docs**: https://platform.claude.com/docs/en/api/rate-limits
- **Cost management docs**: https://code.claude.com/docs/en/costs

## Recurring Monitoring

Set up periodic reporting: `/loop every 30m: /tokenomics`

## Empirical Test Lab

Findings verified ourselves, tests pending. Only move items to main knowledge sections after empirical confirmation.

### Verified (with data)

| # | Hypothesis | Result | Data |
|---|-----------|--------|------|
| 1 | Cache reads count toward Max plan quota | **FALSE** | 20+ turns at 435k context (98%+ cache reads) → 5h usage didn't move |
| 2 | Resume invalidates cache | **TRUE** | Tested 2x. Turn after resume: 0% hit, ~410k cache_creation, ~10% of 5h window |
| 3 | Sending a message on a different model invalidates the original model's cache | **TRUE** | Opus→Sonnet(msg)→Opus: 2.1% hit on return, 11% of 5h window burned. NOTE: the Sonnet msg hit "context limit reached" (470k > 200k limit) but still hit the API |
| 4 | File reads spike quota (not context size) | **TRUE** | 15 file reads spiked 0%→41%. It's the cache_creation from new content, not the high-context turns |
| 5 | Keepalive loop prevents cache expiry | **TRUE** | 30-min loop kept 435k context at 98%+ cache hits indefinitely |
| 5b | 60-min keepalive loop is too slow | **TRUE** | Switched from 30-min to 60-min loop: cache hit on last msg dropped from 99.98% to 0.00% on every single ping (10+ consecutive misses). The 1h TTL + scheduler jitter means 60-min intervals consistently miss. On Max plan this doesn't cost money (flat subscription) but it burns more plan quota per ping since cache misses create full cache rebuilds. 30 min is the correct interval. |
| 6b | 1-min keepalive loop cost over 2+ hours | **NEGLIGIBLE** | Ran every-minute loop for 120+ iterations. Total input grew from 148k to 462k (314k cumulative), but 99%+ was cache reads. Each poll: ~26k input tokens, ~200 uncached. Plan 5h went from 9% to 14% over 2h (mostly from earlier ADR work, not the loop). Context stayed flat at ~2.6%. Extrapolating to the normal 30-min loop: a 60-hour session would barely move the needle. |

### Pending Tests

| # | Hypothesis | How to test | Risk |
|---|-----------|------------|------|
| 6 | Does `/model` toggle alone (without sending a message) kill cache? | In a fresh small-context session: switch Opus→Sonnet→Opus without sending any message on Sonnet, then measure cache_hit | Low — no msg sent means no API call on Sonnet |
| 7 | `/compact` partially invalidates cache (messages portion, not system) | Run `/compact`, measure cache_hit on next turn. If >0% but <previous, it's partial | Medium — compaction itself costs tokens |
| 7 | Editing CLAUDE.md mid-session kills cache | Edit a trivial line in CLAUDE.md, measure next turn cache_hit | High — full rebuild if confirmed |
| 8 | Adding/removing MCP tool mid-session kills cache | Toggle an MCP server via `/mcp`, measure cache_hit | High — full rebuild if confirmed |
| 9 | Subagent spawning cost | Spawn a haiku subagent, measure parent's cache_hit before/after + subagent's own cache_creation | Low — subagents are isolated |
| 10 | `/rewind` invalidates cache | Rewind one turn, measure cache_hit | Medium |
| 11 | Image/screenshot token accumulation | Send 5 screenshots in sequence, measure context growth per image | Low |
| 12 | Thinking tokens visible in transcript | Compare `output_tokens` in JSONL with visible output length, quantify the gap | None — read-only |
| 13 | Multiple tool calls in one turn vs separate turns | Do 5 reads in one turn vs 5 reads across 5 turns, compare total cache_creation | Low |
| 14 | `/clear` + restart vs resume cost | `/clear` then start fresh vs `--resume`, compare total cache_creation | Medium |
| 15 | Does idle time between 5-59 min affect cache? (within 1h TTL) | Leave session idle for 30 min, then send message, check cache_hit | None — just wait |