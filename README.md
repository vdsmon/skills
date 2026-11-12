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
| `cc-keepwarm` | CC only | Keeps Claude Code's prompt cache warm in every session with a silent background ping timed from your last request, and skips the ping once the cache is already gone. |
| `cc-wrap-up` | CC only | Cues a wrap-up at a natural break in a long session, then compacts with better-compact's message or hands off with handoff's resume prompt, with no copy-paste. |
| `cc-pitstop` | CC only | Pauses Claude Code before the 5-hour or weekly usage limit, across every session on the machine, and resumes the paused work on its own when the window resets. |
| `cc-quiet-watch` | CC only | Watches long jobs on a timer and asks Haiku only when the output changed. It wakes the session only when the job is done, failed, stuck or needs you. |
| `better-compact` | any | A better /compact: audit the session, save what compaction would lose, then compact with a focus message and resume with a follow-up. |
| `handoff` | any | Save what only the conversation knows before a session ends, so a fresh session can pick up the work. |
| `humanize` | any | Strip AI-writing tells from text. Detects em-dash overuse, AI vocabulary, inflated significance, rule-of-three, sycophancy, compound coinages, and 20+ more patterns. |
| `git-cleanup` | any | Removes local git branches and worktrees that are safely merged into dev/develop/master/main, skipping dirty worktrees and the main checkout. |
| `grilling` | any | Relentless interview that stress-tests a plan, decision, or idea one round of questions at a time, until you and the agent agree. |
| `question` | any | Answer a genuine question in full, with no edits and no side effects. Treats 'why X and not Y?' as curiosity, not as a hidden request to switch to Y or an attack on X. |
| `idea` | any | Marks a message as a raw idea thought aloud: the agent checks the facts behind it, sharpens it and says what is still open, and builds nothing. |
| `open-pr` | any | Write a short, plain pull request description a teammate reads in a minute: what changes, why now, what they must do. |
| `cc-autotitle` | CC only | Names each Claude Code session on its own: after a few turns it picks a short kebab-case name from the whole session, and renames it again when the work moves on. |
| `cc-dazzle` | CC only | Draws Claude Code's transcript in Catppuccin Mocha: boxed code blocks, box tables, Mermaid diagrams, diff cards in Claude's colors, compact tool rows and timed prompts. |
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
