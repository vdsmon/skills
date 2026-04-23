# Empirical Test Lab

Findings that have been verified ourselves, plus tests still pending. Only move items from pending to verified after empirical confirmation with data.

## Contents
- Verified findings
- Pending tests
- How to add a new test

## Verified findings

| # | Hypothesis | Result | Data |
|---|-----------|--------|------|
| 1 | Cache reads count toward Max plan quota | **FALSE** | 20+ turns at 435k context (98%+ cache reads) → 5h usage didn't move |
| 2 | Resume invalidates cache | **TRUE** | Tested 2x. Turn after resume: 0% hit, ~410k cache_creation, ~10% of 5h window |
| 3 | Sending a message on a different model invalidates the original model's cache | **TRUE** | Opus→Sonnet(msg)→Opus: 2.1% hit on return, 11% of 5h window burned. NOTE: the Sonnet msg hit "context limit reached" (470k > 200k limit) but still hit the API |
| 4 | File reads spike quota (not context size) | **TRUE** | 15 file reads spiked 0%→41%. It's the cache_creation from new content, not the high-context turns |
| 5 | Keepalive loop prevents cache expiry | **TRUE** | 30-min loop kept 435k context at 98%+ cache hits indefinitely |
| 5b | 60-min keepalive loop is too slow | **TRUE** | Switched from 30-min to 60-min loop: cache hit on last msg dropped from 99.98% to 0.00% on every single ping (10+ consecutive misses). The 1h TTL + scheduler jitter means 60-min intervals consistently miss. On Max plan this doesn't cost money (flat subscription) but it burns more plan quota per ping since cache misses create full cache rebuilds. 30 min is the correct interval. |
| 6b | 1-min keepalive loop cost over 2+ hours | **NEGLIGIBLE** | Ran every-minute loop for 120+ iterations. Total input grew from 148k to 462k (314k cumulative), but 99%+ was cache reads. Each poll: ~26k input tokens, ~200 uncached. Plan 5h went from 9% to 14% over 2h (mostly from earlier ADR work, not the loop). Context stayed flat at ~2.6%. Extrapolating to the normal 30-min loop: a 60-hour session would barely move the needle. |

## Pending tests

| # | Hypothesis | How to test | Risk |
|---|-----------|------------|------|
| 6 | Does `/model` toggle alone (without sending a message) kill cache? | In a fresh small-context session: switch Opus→Sonnet→Opus without sending any message on Sonnet, then measure cache_hit | Low — no msg sent means no API call on Sonnet |
| 7 | `/compact` partially invalidates cache (messages portion, not system) | Run `/compact`, measure cache_hit on next turn. If >0% but <previous, it's partial | Medium — compaction itself costs tokens |
| 8 | Editing CLAUDE.md mid-session kills cache | Edit a trivial line in CLAUDE.md, measure next turn cache_hit | High — full rebuild if confirmed |
| 9 | Adding/removing MCP tool mid-session kills cache | Toggle an MCP server via `/mcp`, measure cache_hit | High — full rebuild if confirmed |
| 10 | Subagent spawning cost | Spawn a haiku subagent, measure parent's cache_hit before/after + subagent's own cache_creation | Low — subagents are isolated |
| 11 | `/rewind` invalidates cache | Rewind one turn, measure cache_hit | Medium |
| 12 | Image/screenshot token accumulation | Send 5 screenshots in sequence, measure context growth per image | Low |
| 13 | Thinking tokens visible in transcript | Compare `output_tokens` in JSONL with visible output length, quantify the gap | None — read-only |
| 14 | Multiple tool calls in one turn vs separate turns | Do 5 reads in one turn vs 5 reads across 5 turns, compare total cache_creation | Low |
| 15 | `/clear` + restart vs resume cost | `/clear` then start fresh vs `--resume`, compare total cache_creation | Medium |
| 16 | Does idle time between 5-59 min affect cache? (within 1h TTL) | Leave session idle for 30 min, then send message, check cache_hit | None — just wait |

## How to add a new test

1. Add a row to **Pending tests** with a falsifiable hypothesis, a concrete how-to, and a risk estimate.
2. Run the test; capture numbers (cache_hit %, input_tokens, cache_creation_input_tokens, 5h window delta).
3. Move the row to **Verified findings** with the result and the data that backs it.
4. If the finding changes an existing Optimization strategy in `economics.md`, update that file in the same edit.
