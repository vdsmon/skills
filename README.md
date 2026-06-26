# skills

Personal Claude Code plugins by [@vdsmon](https://github.com/vdsmon).

Each skill ships as its own plugin so you can install only what you want.

## Naming convention

Plugins prefixed with **`cc-`** are Claude-Code-specific — they use features (SessionStart hooks, `` !`cmd` `` dynamic context injection, `${CLAUDE_SKILL_DIR}`, `context: fork`) that don't exist on other [Agent Skills](https://agentskills.io) hosts.

Plugins **without** the `cc-` prefix are portable. They follow the open Agent Skills format and work on any SKILL.md-native host: Claude Code, OpenAI Codex CLI, Gemini CLI, Cursor, Goose, OpenCode, Copilot, Amp, Roo Code, and [many more](https://agentskills.io/clients).

The [Plugins](#plugins) table below lists every plugin and its host — `Host: CC only` is a `cc-` plugin, `Host: any` is portable.

## Install — Claude Code

Register the marketplace once:

```bash
/plugin marketplace add vdsmon/skills
```

Install any plugin by name (see the [Plugins](#plugins) table for the full list):

```bash
/plugin install <name>@vdsmon-skills
```

Or run `/plugins` and pick from the interactive browser.

## Install — OpenAI Codex CLI

This repo ships a native [Codex plugin marketplace](https://developers.openai.com/codex/plugins) (`.agents/plugins/marketplace.json`), so you install the same way Claude Code does — register once, then pick plugins. Only the portable (non-`cc-`) plugins are listed; the `cc-` plugins rely on Claude-Code-only features and won't run on Codex.

```bash
codex plugin marketplace add vdsmon/skills
```

Then browse and install from the interactive picker:

```
/plugins
```

Select a plugin and choose **Install plugin** (Space toggles enabled state).

## Install — other hosts (portable plugins only)

Each host discovers skills in its own directory. Clone this repo, then drop the skill folder into the target path.

```bash
git clone https://github.com/vdsmon/skills
cd skills
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

Generated from `.claude-plugin/marketplace.json` (the source of truth) by `scripts/sync-codex.sh` — do not hand-edit between the markers. `Host: any` is portable; `Host: CC only` needs Claude Code. Run `/plugins` for the full descriptions and triggers.

<!-- BEGIN PLUGINS (generated) -->
| Plugin | Host | What it does |
|---|---|---|
| `investigate` | any | Investigate a reported error or incident end to end across every reachable system, never inferring past a missing source — stop and raise to the human for access or… |
| `slack-draft` | any | Draft a Slack message for the user to send: Slack mrkdwn, lead-with-conclusion, backticked identifiers and domain values, ASCII punctuation. Defaults to English and a… |
| `skill-polish` | any | Post-mortem for any skill — scans a session for friction and applies concrete edits to the responsible skill file. Portable across SKILL.md-native hosts. |
| `cc-tokenomics` | CC only | Token usage, cache hit rates, and Max plan consumption analyzer. /cc-tokenomics dashboard + reference docs on rate limits, cache lifecycle, and empirical billing… |
| `cc-cache-keepalive` | CC only | Keeps Claude Code's prompt cache warm on Max plans via a SessionStart-scheduled silent cron. Opt-in via ~/.cc-cache-keepalive flag file. Cron prompt is sentinel… |
| `cc-usage-guard` | CC only | Pause-at-limit guard for Claude Code. A statusLine sensor records 5h + weekly rate-limit usage; PostToolUse/UserPromptSubmit hooks watch it in two tiers — a soft WARN… |
| `prep-compact` | any | Audit in-flight state before any context-compacting step; produce a copy-paste /compact message plus a queue-able follow-up that chains the next action when compact… |
| `prep-goal` | any | Interrogate a rough objective into a tight, verifiable /goal completion condition before handing it to an autonomous goal loop. Grills one question at a time to pin the… |
| `humanize` | any | Strip AI-writing tells from text. Detects em-dash overuse, AI vocabulary, inflated significance, rule-of-three, sycophancy, and 20+ more patterns. Portable across… |
| `loop-finder` | any | Loop discovery + race + feature-driven iteration. Two skills: loop-finder (engineers a self-verifiable gate for a task class, races parallel variants, converges on the… |
| `brainstorming` | any | Design-before-code gate. Explores intent, proposes 2-3 approaches, presents a design, and gets approval before any implementation. Use before creating features, building… |
| `systematic-debugging` | any | Four-phase debugging discipline (root-cause investigation, pattern analysis, hypothesis, single-fix implementation). No fixes before investigation; 3+ failed fixes means… |
| `skill-smith` | any | Forge for Agent Skills: create, test, evaluate, optimize triggering, and package skills. Merges an empirical eval loop (run with-skill vs baseline, benchmark, iterate)… |
| `git-cleanup` | any | Clean up stale git branches and worktrees. Finds branches merged into dev/develop/master/main, checks worktrees for uncommitted changes, removes what's safe while… |
| `strip-migration-cruft` | any | Scan a repo for transitional / migration / phase / wave / story / legacy-alias cruft comments, bucket into safe-to-strip vs keep-semantic, propose surgical edits and… |
| `grilling` | any | Relentless one-question-at-a-time interview that stress-tests a plan or design to convergence, exploring the codebase to answer its own questions where it can. Bundles… |
| `teach` | any | Stateful, multi-session teaching workspace: grounds every lesson in a MISSION.md, gathers trusted RESOURCES.md, produces short self-contained HTML lessons in the… |
| `codebase-design` | any | Shared vocabulary for designing deep modules: a lot of behaviour behind a small interface, placed at a clean seam, testable through that interface. Precise glossary… |
<!-- END PLUGINS -->

## Layout

```
.claude-plugin/
  marketplace.json                       # Claude Code marketplace (source of truth)
.agents/plugins/
  marketplace.json                       # Codex CLI marketplace (generated, non-cc- only)
mise.toml                                 # Maintainer task runner: mise run sync | bump | verify
scripts/
  bump-plugin.sh                          # Version bump + marketplace sync
  sync-codex.sh                           # Rebuild Codex symlinks + marketplace + README table from the Claude side
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

Both marketplaces share one source of truth: you author `.claude-plugin/*`, then run `scripts/sync-codex.sh` to regenerate the `.codex-plugin` symlinks, the Codex marketplace, and the [Plugins](#plugins) table above. The symlink means each plugin has exactly one `plugin.json`, so versions never drift between hosts.

## License

MIT — see [LICENSE](LICENSE).
