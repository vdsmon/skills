# skills

Personal Agent Skills by [@vdsmon](https://github.com/vdsmon), packaged as a plugin marketplace. Most run on any SKILL.md-native host, and a few are Claude-Code-specific.

Each skill ships as its own plugin so you can install only what you want.

## Naming convention

Plugins prefixed with **`cc-`** are Claude-Code-specific: they use features (SessionStart hooks, `` !`cmd` `` dynamic context injection, `${CLAUDE_SKILL_DIR}`, `context: fork`) that don't exist on other [Agent Skills](https://agentskills.io) hosts.

Plugins **without** the `cc-` prefix are portable. They follow the open Agent Skills format and work on any SKILL.md-native host: Claude Code, OpenAI Codex CLI, Gemini CLI, Cursor, Goose, OpenCode, Copilot, Amp, Roo Code, and [many more](https://agentskills.io/clients).

The [Plugins](#plugins) table below lists every plugin and its host: `Host: CC only` is a `cc-` plugin, `Host: any` is portable.

## Install on Claude Code

Register the marketplace once:

```bash
/plugin marketplace add vdsmon/skills
```

Install any plugin by name (see the [Plugins](#plugins) table for the full list):

```bash
/plugin install <name>@vdsmon-skills
```

Or run `/plugins` and pick from the interactive browser.

## Install on OpenAI Codex CLI

This repo ships a native [Codex plugin marketplace](https://developers.openai.com/codex/plugins) (`.agents/plugins/marketplace.json`), so you install the same way Claude Code does: register once, then pick plugins. Only the portable (non-`cc-`) plugins are listed, since the `cc-` plugins rely on Claude-Code-only features and won't run on Codex.

```bash
codex plugin marketplace add vdsmon/skills
```

Then browse and install from the interactive picker:

```
/plugins
```

Select a plugin and choose **Install plugin** (Space toggles enabled state).

Skills that only run on a `/slash` call in Claude Code stay manual on Codex too: Codex never picks them on its own, so call them with `$<skill>`.

## Install on other hosts (portable plugins only)

Clone this repo and copy the skill folder into the host's skills directory. Each host's path is listed at [agentskills.io/clients](https://agentskills.io/clients).

```bash
git clone https://github.com/vdsmon/skills
cp -r skills/plugins/<plugin>/skills/<skill> <host-skills-dir>/
```

## Plugins

Generated from each plugin's `plugin.json` by `scripts/sync-codex.sh`, so do not hand-edit between the markers. `Host: any` is portable, `Host: CC only` needs Claude Code. Run `/plugins` for the full descriptions and triggers.

<!-- BEGIN PLUGINS (generated) -->
| Plugin | Host | What it does |
|---|---|---|
| `slack-draft` | any | Draft a Slack message for the user to send: Slack mrkdwn, lead-with-conclusion, backticked identifiers and domain values, ASCII punctuation. |
| `skill-polish` | any | Post-mortem for any skill. |
| `cc-cache-keepalive` | CC only | Keeps Claude Code's prompt cache warm on Max plans with an opt-in silent cron, and cancels any tick that a recent real turn or an already-expired cache makes pointless. |
| `cc-usage-guard` | CC only | Pauses Claude Code before it hits the 5-hour or weekly usage limit and auto-resumes when the window resets, on every surface including the desktop app. |
| `prep-compact` | any | Audit in-flight session state before compaction truncates history, and save what would be lost. |
| `prep-exit` | any | Save what only the conversation knows before a session ends, so a fresh session can pick up the work. |
| `prep-goal` | any | Interrogate a rough objective into a tight, verifiable /goal completion condition before handing it to an autonomous goal loop. |
| `humanize` | any | Strip AI-writing tells from text. Detects em-dash overuse, AI vocabulary, inflated significance, rule-of-three, sycophancy, compound coinages, and 20+ more patterns. |
| `brainstorming` | any | Design-before-code gate. Explores intent, proposes 2-3 approaches, presents a design, and gets approval before any implementation. |
| `systematic-debugging` | any | Four-phase debugging discipline (root-cause investigation, pattern analysis, hypothesis, single-fix implementation). |
| `skill-smith` | any | Forge for Agent Skills: create, test, evaluate, optimize triggering, and package skills. |
| `git-cleanup` | any | Clean up stale git branches and worktrees. |
| `strip-migration-cruft` | any | Scan a repo for transitional / migration / phase / wave / story / legacy-alias cruft comments that document past project history rather than current behavior, bucket hits into safe-to-strip vs keep-semantic, then propose surgical edits and execute after confirmation. |
| `grilling` | any | Relentless one-question-at-a-time interview that stress-tests a plan or design to convergence: facts get looked up in the codebase, decisions go to the human, and nothing is enacted until shared understanding is confirmed. |
| `teach` | any | Stateful, multi-session teaching workspace: grounds every lesson in a MISSION.md, gathers trusted RESOURCES.md, produces short self-contained HTML lessons in the learner's zone of proximal development, tracks progress via learning-records, and builds storage strength through retrieval, spacing, and interleaving. |
| `codebase-design` | any | Shared vocabulary for designing deep modules: a lot of behaviour behind a small interface, placed at a clean seam, testable through that interface. |
| `question` | any | Answer a genuine question in full, with no edits and no side effects. Treats 'why X and not Y?' as curiosity, not as a hidden request to switch to Y or an attack on X. |
<!-- END PLUGINS -->

## Layout

```
.claude-plugin/marketplace.json     # Claude Code marketplace: one entry per plugin
.agents/plugins/marketplace.json    # Codex marketplace (generated, portable plugins only)
plugins/<plugin>/
  .claude-plugin/plugin.json        # manifest: name, version, description, hooks
  .codex-plugin -> .claude-plugin   # symlink, portable plugins only (generated)
  skills/<skill>/SKILL.md           # the skill itself
  hooks/                            # cc- plugins only
scripts/                            # sync-codex.sh, bump-plugin.sh, check.py
```

You write `plugin.json` and the skills. `scripts/sync-codex.sh` generates the rest: the Codex marketplace and symlinks, each marketplace entry's description and version, and the [Plugins](#plugins) table above. CI fails a pull request that did not run it.

## License

MIT. See [LICENSE](LICENSE).
