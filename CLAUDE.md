# CLAUDE.md

File guide Claude Code (claude.ai/code) work in this repo.

## Repository purpose

Personal Claude Code plugin marketplace published as `vdsmon/claude-skills`. Each skill ship own plugin — users install only what want. No build, no tests, no package manager — pure content (Markdown skill files, shell hooks, one Python report script).

## Layout and the marketplace contract

```
.claude-plugin/marketplace.json     # Lists every plugin shipped here
plugins/<plugin-name>/
  .claude-plugin/plugin.json        # Plugin manifest (name, version, hooks, skills path)
  skills/<skill-name>/SKILL.md      # Skill prompt with YAML frontmatter
  skills/<skill-name>/scripts/*     # Optional scripts the skill calls
  hooks/*.sh                        # Optional event hooks declared in plugin.json
```

Two invariants preserve when add/rename plugins:

1. **Every plugin listed in `.claude-plugin/marketplace.json`** with `name`, `source: ./plugins/<name>`, `description`, `version`. Forget = plugin invisible to `/plugin install`.
2. **`plugin.json` `name` must match marketplace `name` and directory name.** Skill dir name under `skills/` independent but conventionally matches.

Current plugins: `skill-polish`, `cc-tokenomics`, `cc-cache-keepalive`, `pre-compact`, `humanize`, `dg`, `converge`. Plugins prefixed with `cc-` are Claude-Code-specific (hooks, `` !`cmd` `` dynamic injection, `${CLAUDE_SKILL_DIR}`); unprefixed plugins port cleanly to other Agent Skills hosts (Codex CLI, Gemini CLI, Cursor, Goose, etc.). `cc-tokenomics` is analysis + education only; cache warmup lives in `cc-cache-keepalive`.

## Anatomy of a skill

`SKILL.md` frontmatter fields affect behavior:

- `name` — slug to invoke skill
- `description` — what skill does + when to use; third person. Claude Code matches against user intent. Keep ≤280 chars, push trigger phrases to `when_to_use`.
- `when_to_use` — trigger phrases. Appended to description in the skill listing. Shared 1,536-char cap.
- `argument-hint` / `arguments` — autocomplete hint + named positional args for `$ARGUMENTS`/`$N`/`$name` substitution.
- `allowed-tools` — pre-approved Bash/tool patterns (see `humanize`, `cc-tokenomics`).
- `paths` — glob gate; auto-trigger only when matching files are open.
- `context: fork` + `agent` — run skill in an isolated subagent.
- `disable-model-invocation` — user-only (manual `/slash` trigger).
- `user-invocable: false` — hide from `/` menu (background knowledge only).

Body = prompt, not docs. Second-person imperative. Keep CLAUDE.md concision: every token re-cached on prefix invalidation.

**Progressive disclosure**: move reference content out of `SKILL.md` into sibling files (see `cc-tokenomics/skills/cc-tokenomics/reference/*.md`). Keep references one level deep — chains of `.md` → `.md` → `.md` cause partial reads. Aim for ≤100 lines in `SKILL.md`.

**Dynamic context injection**: use `` !`cmd` `` inline or `` ```! `` fenced blocks in the skill body to pre-run shell commands. Output replaces the placeholder before the model reads the skill. Use `${CLAUDE_SKILL_DIR}` for portable script paths, `$ARGUMENTS` / `$0` for user args.

**Multi-file skills** (agent siblings): skill dir may contain extra `.md` files alongside `SKILL.md`. Orchestrator `SKILL.md` reads siblings, passes content to dispatched `Agent` tool calls (see `dg`'s `dinesh-agent.md` + `gilfoyle-agent.md`). Sibling paths relative to skill dir.

**ultrathink trigger**: include the literal word `ultrathink` anywhere in skill body to switch on extended thinking for the turn when the skill fires. Useful for analysis-heavy skills.

## Hooks (only cc-cache-keepalive uses one)

`plugins/cc-cache-keepalive/.claude-plugin/plugin.json` declares `SessionStart` hook running `hooks/keepalive.sh`. Pattern preserve when adding hooks:

- **Opt-in via flag file in `$HOME`** (`~/.cc-cache-keepalive`). Hook short-circuits with `exit 0` when flag absent — zero output, zero side effects for non-opt-in users.
- **Flag file doubles as config**: first line overrides default interval, regex-validated with fallback.
- **Hook emits instruction inside `<name-of-hook>` XML tag to stdout.** Claude Code injects stdout as system reminder; model sees as directive to schedule `CronCreate` with a silent-prefix prompt.
- **Do NOT use `/loop` for scheduling** — its `Nm` → `*/N * * * *` rewrite lands every user on fleet-peak minutes (:00/:30). The hook computes an anchored cron itself.
- **Silent-mode rule lives in the cron prompt**, not in any skill — the prompt string emitted by the hook starts with `[Silent cc-cache-keepalive — run Bash tool only. No text output, no acknowledgment, no summary.]`. Model reads that directive and runs Bash silently. Don't duplicate the rule in a SKILL.md.

## The one script: `token-report.py`

`plugins/cc-tokenomics/skills/cc-tokenomics/scripts/token-report.py` self-contained Python 3 (stdlib only, no deps). Three data sources:

1. Session JSONL transcripts at `~/.claude/projects/<mangled-cwd>/*.jsonl` — parses `assistant` events for `usage` blocks.
2. Plan usage from `https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20`, using OAuth token from macOS Keychain (`security find-generic-password -s "Claude Code-credentials"`). Keychain-only — breaks on Linux.
3. Per-file state cache `<session>.jsonl.tokenomics-state.json` for delta tracking.

Called from `SKILL.md` via dynamic-context injection: the `` ```! `` block runs `python3 "${CLAUDE_SKILL_DIR}/scripts/token-report.py" $ARGUMENTS` at invocation, so the numbers arrive before the model reads the skill. Can also run directly: `python3 plugins/cc-tokenomics/skills/cc-tokenomics/scripts/token-report.py [--all|<path>]`. Experiment findings live in `plugins/cc-tokenomics/skills/cc-tokenomics/reference/experiments.md` — update the table when running new tests rather than writing new docs.

## Conventions

- **No README/docs bloat inside plugins.** SKILL.md = prompt; separate docs rot and burn cache.
- **Version bumps**: bump both `plugin.json` version and marketplace.json entry for plugin. Keep sync.

## Installing locally for testing

```
/plugin marketplace add /Users/victordsm/repos/personal/claude-skills
/plugin install <plugin-name>@vdsmon-skills
```

After editing SKILL.md, reinstall or restart session — marketplace caches skill content.

For tight iteration without reinstalling, copy skill dir to `~/.claude/skills/<name>/` and edit in place — harness re-reads each session.