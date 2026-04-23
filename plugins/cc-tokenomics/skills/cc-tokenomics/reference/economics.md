# Token Economics Reference

How Claude Code token billing, caching, and rate limits work on the Max plan. Sourced from [official Anthropic docs](https://platform.claude.com/docs/en/api/rate-limits) plus empirical testing captured in `experiments.md`.

## Contents
- The three token types
- What counts toward Max plan quota
- Cache lifecycle
- Cache TTL by plan
- The 5-hour window
- The 7-day window
- Optimization strategies

## The three token types

Every API call produces three categories of input tokens:

| Type | What it is | Counts toward ITPM rate limit? | Counts toward Max plan quota? | Cost (API) |
|------|-----------|-------------------------------|------------------------------|------------|
| `input_tokens` | Uncached tokens after the last cache breakpoint | **YES** | **YES** | Full price |
| `cache_creation_input_tokens` | Tokens being written to cache for the first time | **YES** | **YES** | 125% of input price |
| `cache_read_input_tokens` | Tokens served from prompt cache | **NO** (for Opus 4.x, Sonnet 4.x, Haiku 4.5) | **NO** (empirically confirmed) | 10% of input price |

Source: [Anthropic Rate Limits docs](https://platform.claude.com/docs/en/api/rate-limits) — "For most Claude models, only uncached input tokens count towards your ITPM rate limits."

Note: old models (Haiku 3, Haiku 3.5, marked † in Anthropic tables) DO count cache reads toward ITPM. Current models (Opus 4.x, Sonnet 4.x, Haiku 4.5) do NOT.

## What counts toward Max plan quota

Cache reads are free on every dimension: cheap dollars (10% rate) AND free toward quota. Confirmed empirically (see `experiments.md` tests #1 and #4):

- 20+ rapid ping/pong turns at ~435k context (98%+ cache reads) → plan usage did not move
- 15 file reads injecting new content → plan usage spiked from 0% to 41%
- Conclusion: only `input_tokens` + `cache_creation_input_tokens` consume quota. Cache reads are free.

### Expensive (burns quota fast)

- **Resuming a session** (`claude --resume`) — full cache rebuild, zero cache hits on first message. Claude Code warns: "tokens will be rebuilt from scratch (no cache)". Each resume costs ~410k cache_creation tokens and ~10% of the 5h window.
- **Switching models and sending a message** (`/model`) — caches are model-isolated. Sending a message on a different model then switching back forces a full cache rebuild on the original model. Empirical: Opus→Sonnet(msg)→Opus dropped cache to 2.1%, burned 11% of the 5h window. Even a failed message (context limit exceeded) counts. Whether toggling `/model` without sending a message kills the cache is unverified (pending test #6).
- Reading new files (each file content = cache_creation tokens on first read)
- Editing CLAUDE.md or the system prompt (invalidates the entire cached prefix, forces re-creation)
- Starting a new session (full cache creation on first message)
- Long idle gaps beyond cache TTL (1h Max, 5m Pro) — next message re-creates everything
- Spawning subagents (each gets its own context window + cache)

### Cheap (barely moves quota)

- Normal conversation after the first few turns (almost all cache reads)
- Short messages back and forth (small output tokens, cache reads dominate)
- Tool calls returning small results (grep, ls, etc.)
- `/cc-tokenomics` report itself (~500 tokens per run)

### Free (zero quota impact)

- Idle time (no API calls = no tokens)
- Status line updates (client-side)
- Reading files already in context (dedup by harness)

## Cache lifecycle

1. **First message**: full cache creation (~20-50k tokens for system prompt + CLAUDE.md + skills). Expensive.
2. **Subsequent messages**: cache reads for the prefix + small cache creation for new conversation turns. Cheap.
3. **Cache expires**: next message re-creates everything. Expensive.
4. **Editing CLAUDE.md**: invalidates the prefix cache. Next message re-creates from scratch.
5. **Auto-compaction**: context near limit → older messages summarized. Creates new cache entries but reduces total context size.
6. **Resume (`claude --resume`)**: reconstructs the conversation from JSONL transcript. Different token sequence than the original → entire cache invalidated. First message after resume has 0% cache hit rate, pays full cache_creation cost. Claude Code warns: "tokens will be rebuilt from scratch (no cache). Consider /clear for a cheaper fresh start."

## Cache TTL by plan

| Plan | Cache TTL | Cache write cost | Keepalive strategy |
|------|-----------|-----------------|-------------------|
| **Max** | **1 hour** | 2x base input price | 30-min cron — only viable interval. 60-min does not work (TTL + jitter = consistent misses, verified test #5b). Intermediate values like 45-min can't be expressed cleanly in cron (only divisors of 60 work: 1,2,3,4,5,6,10,12,15,20,30). |
| **Pro** | 5 minutes | 1.25x base input price | Needs ~3-4 min loop (aggressive) |
| **API** | 5 minutes | 1.25x base input price | Implement in application logic |

The Max plan's 1h TTL is a massive advantage — a 50-min break and the cache survives. On Pro, a 6-min pause kills the cache and triggers a full rebuild.

See `keepalive.md` for the cache warmup utility (shipped as the separate `cc-cache-keepalive` plugin).

## The 5-hour window

- Rolling window, starts when the first message is sent (floored to the hour)
- Counts `input_tokens` + `cache_creation_input_tokens` (NOT cache reads)
- Resets fully when the window expires
- Warmup trick: send a minimal message early (e.g. via [claude-warmup](https://github.com/vdsmon/claude-warmup)) to anchor the window reset at a convenient time

## The 7-day window

- Weekly rolling quota, separate from the 5h window
- Same count rules as 5h (cache reads don't count)
- Max 5x plan = 5x Pro quota; Max 20x = 20x Pro quota

## Optimization strategies

1. **Keep the cache alive, never resume.** On Max the cache lives 1 hour; the `cc-cache-keepalive` plugin keeps it warm forever. Keepalive cost is negligible: each poll is ~26k input tokens but 99%+ cache reads (~200 uncached tokens per poll). Over 120+ iterations at 1-min intervals, plan usage barely moved. At 30-min intervals, a session can run for days without meaningful quota impact. Never quit and resume — resume invalidates the entire cache (0% hit rate, full rebuild ~410k cache_creation tokens, ~10% of 5h window per resume). Must leave → keep the session running. Session died → `/clear` and start fresh is cheaper than resuming a large conversation.
2. **Avoid bulk file reads.** Each new file = cache_creation tokens. Use targeted reads (specific lines) instead of reading whole files.
3. **Don't edit CLAUDE.md mid-session.** Invalidates the entire cache prefix. Edit between sessions if possible.
4. **Use `/clear` wisely.** Clears context; next message re-creates the cache. Good for task switches, expensive if continuing the same work.
5. **Never switch models mid-session** (`/model`). Caches are model-isolated. Even toggling back to the same model destroys the cache. Empirical: cost 11% of 5h window in one turn. Need a different model → use a subagent or a separate session.
6. **Anchor the 5h window.** Use the warmup trick to schedule resets at convenient times.
7. **Delegate verbose operations to subagents.** Output stays in the subagent context, not yours.
8. **Keep CLAUDE.md lean.** Every token in CLAUDE.md is re-cached on every prefix invalidation. 200 lines max.
