# claude-skills

Personal Claude Code plugins by [@vdsmon](https://github.com/vdsmon).

Each skill ships as its own plugin so you can install only what you want.

## Install

Register the marketplace once:

```bash
/plugin marketplace add vdsmon/claude-skills
```

Then install whichever plugins you want:

```bash
/plugin install skill-polish@vdsmon-skills
/plugin install tokenomics@vdsmon-skills
/plugin install cache-keepalive@vdsmon-skills
/plugin install pre-compact@vdsmon-skills
/plugin install humanize@vdsmon-skills
/plugin install dg@vdsmon-skills
/plugin install converge@vdsmon-skills
```

## Plugins

### `skill-polish`

Post-mortem for any skill. Scans the conversation for friction (corrections, skipped steps, rejected tool calls), traces each to the responsible skill file, and applies concrete edits.

Trigger: `skill-polish`, `polish the skill`, `improve the skill`, `that should have been automatic`, `you skipped X`, `close the gaps`.

Works on any skill, not just its own.

### `tokenomics`

Analyzes Claude Code token usage, cache hit rates, and Max plan consumption. Dashboard + reference library on rate limits, cache lifecycle, and empirical billing experiments. Runs `scripts/token-report.py` via dynamic context injection so the dashboard renders in one turn.

Trigger: `tokenomics`, `how much have I used`, `cache stats`, `am I going to hit the limit`, `show my usage`, or any question about token/plan consumption.

Analysis + education only. For prompt-cache warmup, install `cache-keepalive`.

### `cache-keepalive`

Keeps the prompt cache warm on Max plans (1h TTL). At every SessionStart, emits an instruction telling Claude to schedule an anchored `CronCreate` firing a no-op shell script every 30 minutes. Each firing is an API turn against the cached prefix, which resets the TTL.

**Opt in:** `touch ~/.cache-keepalive`. Without the flag file, the hook exits silently.

- Default interval: `30m`. Override by writing it on the first line of the flag file, e.g. `echo 15m > ~/.cache-keepalive`.
- Format: `<digits><s|m|h|d>` (e.g. `90s`, `4m`, `2h`). Invalid values fall back to `30m`.
- Why 30 min: Max plan's 1h cache TTL + scheduler jitter means 60-min intervals consistently miss (verified empirically). Cron's minute granularity requires intervals that divide 60 cleanly.
- Why anchored cron instead of `/loop`: `/loop`'s `Nm` → `*/N * * * *` rewrite lands every user on fleet-peak minutes (:00/:30). The hook computes its own cron anchored to session-start minute.
- No skill, no UI — pure infrastructure plugin.

### `pre-compact`

Audits in-flight session state before `/compact` truncates context. Flags uncommitted git changes, scratch files, unfinished plans, running background tasks. Produces a copy-paste focus message for the next session.

Trigger: `compact`, `let's compact`, `ready to compact?`, `prep for compact`, `suggest a compact message`.

### `humanize`

Removes signs of AI-generated writing from text. Detects and fixes em-dash overuse, AI vocabulary, inflated significance, rule-of-three, negative parallelisms, sycophancy, and 20+ more patterns.

Trigger: `humanize this`, `remove AI tells`, `edit for voice`, `sounds too AI`, `make this more human`, or when editing/reviewing text.

### `dg`

Adversarial code review. Two Agent-tool personas (Gilfoyle attacks, Dinesh defends) debate a diff and converge on an actionable verdict. HBO's *Silicon Valley* energy, reviewer-level output.

Trigger: `/dg`, `/dg <rounds>`, `/dg <path>`.

### `converge`

Runs a prompt or slash command in a loop until changes converge (no new edits) or start churning (same files flip-flopping). Each pass runs in a fresh Agent subagent for impartial review.

Trigger: `converge`, `run until stable`, `keep running until done`, `repeat until clean`, `run /simplify until it stops finding things`.

## Layout

```
.claude-plugin/
  marketplace.json                       # Lists all plugins shipped here
plugins/
  skill-polish/
    .claude-plugin/plugin.json
    skills/skill-polish/SKILL.md
  tokenomics/
    .claude-plugin/plugin.json
    skills/tokenomics/
      SKILL.md
      scripts/token-report.py
      reference/{economics,experiments,keepalive}.md
  cache-keepalive/
    .claude-plugin/plugin.json           # Declares SessionStart hook
    hooks/keepalive.sh                   # Opt-in, flag-gated
    scripts/keepalive-noop.sh
  pre-compact/
    .claude-plugin/plugin.json
    skills/pre-compact/SKILL.md
  humanize/
    .claude-plugin/plugin.json
    skills/humanize/SKILL.md
  dg/
    .claude-plugin/plugin.json
    skills/dg/{SKILL.md,dinesh-agent.md,gilfoyle-agent.md}
  converge/
    .claude-plugin/plugin.json
    skills/converge/SKILL.md
```

## License

MIT — see [LICENSE](LICENSE).
