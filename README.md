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
| `pre-compact` | — | Any host |
| `humanize` | — | Any host |
| `dg` | — | Any host (dispatches subagents via whatever mechanism the host provides) |
| `converge` | — | Any host (same caveat) |
| `skill-polish` | — | Any host |

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
/plugin install pre-compact@vdsmon-skills
/plugin install dg@vdsmon-skills
/plugin install converge@vdsmon-skills

# Claude-Code-specific
/plugin install cc-tokenomics@vdsmon-skills
/plugin install cc-cache-keepalive@vdsmon-skills
```

## Install — other hosts (portable plugins only)

Each host discovers skills in its own directory. Clone this repo, then drop the skill folder into the target path.

```bash
git clone https://github.com/vdsmon/claude-skills
cd claude-skills
```

### OpenAI Codex CLI

```bash
mkdir -p ~/.codex/skills
cp -r plugins/humanize/skills/humanize          ~/.codex/skills/
cp -r plugins/pre-compact/skills/pre-compact    ~/.codex/skills/
cp -r plugins/dg/skills/dg                      ~/.codex/skills/
cp -r plugins/converge/skills/converge          ~/.codex/skills/
cp -r plugins/skill-polish/skills/skill-polish  ~/.codex/skills/
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
- No skill, no UI — pure infrastructure plugin.

### `pre-compact` (portable)

Audits in-flight session state before any context-compacting step truncates history. Flags uncommitted git changes, scratch files, unfinished plans, running background tasks. Produces a copy-paste focus message for the next session. Compacting is a general agent concept — Claude Code's `/compact`, Codex's summarise-and-continue, Cursor's context prune, etc. — so this skill works across hosts.

Trigger: `compact`, `let's compact`, `ready to compact?`, `prep for compact`, `suggest a compact message`, `shrink the context`, `summarise and continue`.

`--message-only` flag skips the audit and outputs just the focus message.

### `humanize` (portable)

Rewrites text to strip AI-writing tells and inject human voice. Detects em-dash overuse, AI vocabulary, inflated significance, rule-of-three, negative parallelisms, sycophancy, and 20+ more patterns.

Trigger: `humanize this`, `remove AI tells`, `edit for voice`, `sounds too AI`, `make this more human`.

### `dg` (portable)

Adversarial code review. Two subagents (Gilfoyle attacks, Dinesh defends) debate a diff and converge on an actionable verdict. HBO's *Silicon Valley* energy, reviewer-level output.

Trigger: `/dg`, `/dg <rounds>`, `/dg <path>`.

### `converge` (portable)

Runs a prompt or slash command in a loop until changes converge (no new edits) or start churning (same files flip-flopping). Each pass runs in a fresh subagent for impartial review.

Trigger: `converge`, `run until stable`, `keep running until done`, `repeat until clean`.

## Layout

```
.claude-plugin/
  marketplace.json                       # Lists all plugins shipped here
plugins/
  skill-polish/
    .claude-plugin/plugin.json
    skills/skill-polish/SKILL.md
  cc-tokenomics/
    .claude-plugin/plugin.json
    skills/cc-tokenomics/
      SKILL.md
      scripts/token-report.py
      reference/{economics,experiments,keepalive}.md
  cc-cache-keepalive/
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
