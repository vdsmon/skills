# claude-skills

Personal Claude Code plugins by [@vdsmon](https://github.com/vdsmon).

Each skill ships as its own plugin so you can install only what you want.

## Naming convention

Plugins prefixed with **`cc-`** are Claude-Code-specific — they use features (SessionStart hooks, `` !`cmd` `` dynamic context injection, `${CLAUDE_SKILL_DIR}`, `context: fork`) that don't exist on other [Agent Skills](https://agentskills.io) hosts.

Plugins **without** the `cc-` prefix are portable. They follow the open Agent Skills format and work on any SKILL.md-native host: Claude Code, OpenAI Codex CLI, Gemini CLI, Cursor, Goose, OpenCode, Copilot, Amp, Roo Code, and [many more](https://agentskills.io/clients).

| Plugin | Prefix | Portable |
|---|---|---|
| `cc-tokenomics` | cc- | Claude Code only |
| `cc-cache-keepalive` | cc- | Claude Code only |
| `prep-compact` | — | Any host |
| `prep-goal` | — | Any host |
| `humanize` | — | Any host |
| `skill-polish` | — | Any host |
| `loop-finder` | — | Any host |

## Install — Claude Code

Register the marketplace once:

```bash
/plugin marketplace add vdsmon/claude-skills
```

Install whichever plugins you want:

```bash
# Portable
/plugin install skill-polish@vdsmon-skills
/plugin install humanize@vdsmon-skills
/plugin install prep-compact@vdsmon-skills
/plugin install prep-goal@vdsmon-skills
/plugin install loop-finder@vdsmon-skills

# Claude-Code-specific
/plugin install cc-tokenomics@vdsmon-skills
/plugin install cc-cache-keepalive@vdsmon-skills
```

## Install — OpenAI Codex CLI

This repo ships a native [Codex plugin marketplace](https://developers.openai.com/codex/plugins) (`.agents/plugins/marketplace.json`), so you install the same way Claude Code does — register once, then pick plugins. Only the portable (non-`cc-`) plugins are listed; the `cc-` plugins rely on Claude-Code-only features and won't run on Codex.

```bash
codex plugin marketplace add vdsmon/claude-skills
```

Then browse and install from the interactive picker:

```
/plugins
```

Select a plugin and choose **Install plugin** (Space toggles enabled state).

## Install — other hosts (portable plugins only)

Each host discovers skills in its own directory. Clone this repo, then drop the skill folder into the target path.

```bash
git clone https://github.com/vdsmon/claude-skills
cd claude-skills
```

### Gemini CLI

```bash
mkdir -p ~/.gemini/skills
cp -r plugins/humanize/skills/humanize        ~/.gemini/skills/
# ... etc
```

### Cursor

```bash
# Cursor reads skills from its configured skills directory; see Cursor docs.
cp -r plugins/humanize/skills/humanize <cursor-skills-dir>/
```

### Goose, OpenCode, Roo Code, Copilot, Amp, etc.

Same pattern — `cp -r plugins/<name>/skills/<name>` into the host's skills directory. Per-host paths: [agentskills.io/clients](https://agentskills.io/clients).

### Universal installers

For one-command multi-host install:

- [`skillport`](https://github.com/gotalab/skillport) — `pip install skillport`, targets many hosts via CLI or MCP.
- [`openskills`](https://github.com/numman-ali/openskills) — `npm i -g openskills`.
- [`agent-skill-creator`](https://github.com/FrancyJGLisboa/agent-skill-creator) — auto-converts SKILL.md to host-specific formats (`.mdc`, `.md rules`, etc.) for Cursor/Windsurf/Cline.

## Plugins

### `skill-polish` (portable)

Post-mortem for any skill. Scans the conversation for friction (corrections, skipped steps, rejected tool calls), traces each to the responsible skill file, and applies concrete edits.

Trigger: `skill-polish`, `polish the skill`, `improve the skill`, `that should have been automatic`, `you skipped X`, `close the gaps`.

### `cc-tokenomics` (Claude Code only)

Analyzes Claude Code token usage, cache hit rates, and Max plan consumption. `/cc-tokenomics` renders a compact dashboard; reference library covers rate limits, cache lifecycle, and empirical billing experiments. Uses dynamic context injection so the report script runs pre-model.

Trigger: `/cc-tokenomics`, `tokens`, `cache stats`, `am I going to hit the limit`, `show my usage`.

For cache warmup, install `cc-cache-keepalive`.

### `cc-cache-keepalive` (Claude Code only)

Keeps the prompt cache warm on Max plans (1h TTL). At every SessionStart, emits an instruction telling Claude to schedule an anchored `CronCreate` firing a no-op shell script every 30 minutes. Each firing is an API turn against the cached prefix, which resets the TTL.

**Opt in:** `touch ~/.cc-cache-keepalive`. Without the flag file, the hook exits silently.

- Default interval: `30m`. Override by writing it on the first line of the flag file, e.g. `echo 15m > ~/.cc-cache-keepalive`.
- Format: `<digits><s|m|h|d>` (e.g. `90s`, `4m`, `2h`). Invalid values fall back to `30m`.
- Why 30 min: Max plan's 1h cache TTL + scheduler jitter means 60-min intervals consistently miss (verified empirically).
- Why anchored cron instead of `/loop`: `/loop`'s `Nm` → `*/N * * * *` rewrite lands every user on fleet-peak minutes (:00/:30). The hook computes its own cron anchored to session-start minute.
- Headless kill switch: export `CC_KEEPALIVE_OFF=1` to skip the keepalive for a single invocation — e.g. an orchestrator resuming a stalled background run with `CC_KEEPALIVE_OFF=1 claude -p --resume <id> "..."`. Useful for any transient automated session that would otherwise zombie at `state=working` because a recurring cron keeps it alive forever.
- No skill, no UI — pure infrastructure plugin.

### `prep-compact` (portable)

Audits in-flight session state before any context-compacting step truncates history. Flags uncommitted git changes, scratch files, unfinished plans, running background tasks. Produces a copy-paste focus message for the next session. Compacting is a general agent concept — Claude Code's `/compact`, Codex's summarise-and-continue, Cursor's context prune, etc. — so this skill works across hosts.

Trigger: `compact`, `let's compact`, `ready to compact?`, `prep for compact`, `suggest a compact message`, `shrink the context`, `summarise and continue`.

`--message-only` flag skips the audit and outputs just the focus message.

### `prep-goal` (portable)

Sharpens a rough objective into a tight, verifiable completion condition before you hand it to an autonomous goal loop (Claude Code's native `/goal`, or any host's run-until-done mode). These loops run for hours and burn a lot of tokens, so the goal is the whole ballgame — a vague one chases the wrong target before anyone notices. The skill grills one question at a time to pin the real end-state, the proof the evaluator can actually see (the loop's evaluator only judges what the agent surfaces in chat, not files it reads), a scope fence, the cheapest way to game the condition (so it can forbid it), and a turn cap. Then it emits a short paste-ready `/goal` line.

Trigger: `prep-goal`, `sharpen this goal`, `turn this into a goal`, `write a /goal for X`, `what should my goal be`, `help me set a goal`.

### `humanize` (portable)

Rewrites text to strip AI-writing tells and inject human voice. Detects em-dash overuse, AI vocabulary, inflated significance, rule-of-three, negative parallelisms, sycophancy, and 20+ more patterns.

Trigger: `humanize this`, `remove AI tells`, `edit for voice`, `sounds too AI`, `make this more human`.

### `loop-finder` (portable)

Ships two skills in one plugin.

- **`/loop-finder`** — engineers a self-verifiable end-to-end feedback loop for a task class, baselines it, races parallel variants against the baseline, and converges on the best loop config. HITL is concentrated at permission gates (install CLI, register MCP, touch shared files), never mid-iteration. Caches per task class so future runs reuse.
- **`/loop-finder:feature-cycle`** — outer queued-fix chain wrapping the converged gate. One cycle = ship the prior cycle's queued harness fix, ship the next feature against the gate, retro Pain / Workaround / Fix queued, log to per-class `feature-log.jsonl`. Karpathy autoresearch discipline applied to dev experience. Absorbed the standalone `adx-loop` plugin in v0.2.0.

Trigger: `/loop-finder`, `engineer a feedback loop`, `race loop variants`, `set up a self-verifiable harness for X` (gate discovery); `/loop-finder:feature-cycle`, `self-improvement loop`, `harness pressure-test`, `dogfood tooling against feature backlog`, `ADX loop` (outer cycle).

## Layout

```
.claude-plugin/
  marketplace.json                       # Claude Code marketplace (source of truth)
.agents/plugins/
  marketplace.json                       # Codex CLI marketplace (generated, non-cc- only)
mise.toml                                 # Maintainer task runner: mise run sync | bump | verify
scripts/
  bump-plugin.sh                          # Version bump + marketplace sync
  sync-codex.sh                           # Rebuild Codex symlinks + marketplace from the Claude side
plugins/
  skill-polish/                           # portable
    .claude-plugin/plugin.json
    .codex-plugin -> .claude-plugin       # symlink; Codex reads .codex-plugin/plugin.json
    skills/skill-polish/SKILL.md
  cc-tokenomics/                          # cc- = Claude Code only, NO .codex-plugin symlink
    .claude-plugin/plugin.json
    skills/cc-tokenomics/
      SKILL.md
      scripts/token-report.py
      reference/{economics,experiments,keepalive}.md
  cc-cache-keepalive/                     # cc- = Claude Code only, NO .codex-plugin symlink
    .claude-plugin/plugin.json           # Declares SessionStart hook
    hooks/keepalive.sh                   # Opt-in, flag-gated
    scripts/keepalive-noop.sh
  humanize/                               # portable
    .claude-plugin/plugin.json
    .codex-plugin -> .claude-plugin
    skills/humanize/SKILL.md
```

Both marketplaces share one source of truth: you author `.claude-plugin/*`, then run `scripts/sync-codex.sh` to regenerate the `.codex-plugin` symlinks and the Codex marketplace. The symlink means each plugin has exactly one `plugin.json`, so versions never drift between hosts.

## License

MIT — see [LICENSE](LICENSE).
