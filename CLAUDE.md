# CLAUDE.md

File guide Claude Code (claude.ai/code) work in this repo.

## Repository purpose

Personal Claude Code plugin marketplace published as `vdsmon/skills`. Each skill ship own plugin — users install only what want. No build, no package manager — pure content (Markdown skill files, shell hooks, one Python report script). Tests exist only where hooks have real failure modes (`mise run test:usage-guard` for cc-usage-guard's sensor/guard pair); run them when touching those hooks.

## Layout and the marketplace contract

```
.claude-plugin/marketplace.json     # Claude Code marketplace — lists every plugin (source of truth)
.agents/plugins/marketplace.json    # Codex CLI marketplace — GENERATED, non-cc- plugins only
plugins/<plugin-name>/
  .claude-plugin/plugin.json        # Plugin manifest (name, version, hooks, skills path) — source of truth
  .codex-plugin -> .claude-plugin   # Symlink (non-cc- only); Codex reads .codex-plugin/plugin.json
  skills/<skill-name>/SKILL.md      # Skill prompt with YAML frontmatter
  skills/<skill-name>/scripts/*     # Optional scripts the skill calls
  hooks/*.sh                        # Optional event hooks declared in plugin.json
```

Dual marketplace, one source of truth. `.claude-plugin/*` is authored; the Codex artifacts are **derived** by `scripts/sync-codex.sh` (run it after adding/removing/renaming a plugin). Never hand-edit the Codex side:

- `.codex-plugin` is a **symlink to `.claude-plugin`** (git mode 120000). Codex requires the manifest at `.codex-plugin/plugin.json`; the symlink means there is exactly one `plugin.json` per plugin, so version and description can never drift between hosts. `bump-plugin.sh` only touches `.claude-plugin/plugin.json` — the Codex side follows for free.
- `.agents/plugins/marketplace.json` is regenerated from `.claude-plugin/marketplace.json` (cc- plugins dropped, schema remapped to Codex's `source`/`policy`/`category` shape).
- **cc- plugins are not Codex-installable** (hooks, `` !`cmd` `` injection, `${CLAUDE_SKILL_DIR}`, session-JSONL parsing don't run on Codex). They get no `.codex-plugin` symlink and are excluded from the Codex marketplace. A `.codex-plugin` symlink means "Codex-installable".

Three invariants preserve when add/rename plugins:

1. **Every plugin listed in `.claude-plugin/marketplace.json`** with `name`, `source: ./plugins/<name>`, `description`, `version`. Forget = plugin invisible to `/plugin install`.
2. **`plugin.json` `name` must match marketplace `name` and directory name.** Skill dir name under `skills/` independent but conventionally matches.
3. **Run `mise run sync`** (= `scripts/sync-codex.sh`) after adding/removing/renaming a plugin (or flipping its cc- prefix) to regenerate the symlink + Codex marketplace. Idempotent; commit whatever it changes. `mise run verify` fails if the Codex artifacts are stale.

Maintainer tasks live in `mise.toml` (task runner only, no tool pinning): `mise run sync` | `bump <plugin> [level]` | `verify`. The scripts under `scripts/` stay runnable standalone for anyone without mise.

The current plugin list lives in `.claude-plugin/marketplace.json` (source of truth) and the generated table in `README.md` — don't re-enumerate it here. Plugins prefixed with `cc-` are Claude-Code-specific (hooks, `` !`cmd` `` dynamic injection, `${CLAUDE_SKILL_DIR}`); unprefixed plugins port cleanly to other Agent Skills hosts (Codex CLI, Gemini CLI, Cursor, Goose, etc.). Knowledge not derivable from the dir names: `cc-tokenomics` is analysis + education only, cache warmup lives in `cc-cache-keepalive`; multi-skill plugins are `loop-finder` (ships `loop-finder` + `feature-cycle`) and `grilling` (ships `grilling` + `domain-modeling` + `grill-with-docs`).

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

Invocation policy: gate misfire-prone or token-heavy skills user-only (`disable-model-invocation: true`) so they fire only on explicit `/slash`; keep proactive guardrails (e.g. `brainstorming`) and friction-catchers (e.g. `skill-polish`) model-invocable. An edit/confirm gate inside the skill flow is not a reason to also block auto-fire.

Body = prompt, not docs. Second-person imperative. Keep CLAUDE.md concision: every token re-cached on prefix invalidation.

**Progressive disclosure**: move reference content out of `SKILL.md` into sibling files (see `cc-tokenomics/skills/cc-tokenomics/reference/*.md`). Keep references one level deep — chains of `.md` → `.md` → `.md` cause partial reads. Aim for ≤100 lines in `SKILL.md`.

**Dynamic context injection**: use `` !`cmd` `` inline or `` ```! `` fenced blocks in the skill body to pre-run shell commands. Output replaces the placeholder before the model reads the skill. Use `${CLAUDE_SKILL_DIR}` for portable script paths, `$ARGUMENTS` / `$0` for user args.

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

## Plugin sub-dirs: `scripts/` + `templates/`

Some plugins ship more than `SKILL.md` + hooks. Two conventions:

- **`plugins/<plugin>/skills/<skill>/scripts/`** — helper scripts the skill invokes (e.g. `plugins/cc-tokenomics/skills/cc-tokenomics/scripts/token-report.py`). Keeps deterministic logic out of the skill prose, which the model would otherwise re-interpret each invocation.
- **`plugins/<plugin>/templates/`** — files copied into a project the first time the skill runs there (bootstrap pattern). Skill's `Bootstrap` block detects the template root via `${CLAUDE_SKILL_DIR}/../../templates` and `cp`s missing files. Example: `plugins/loop-finder/templates/iterate.sh.tmpl`.

## Conventions

- **No README/docs bloat inside plugins.** SKILL.md = prompt; separate docs rot and burn cache.
- **Version bump + publish, whenever a plugin's files change.** This is a MUST that closes the change, not an optional follow-up. Run `scripts/bump-plugin.sh <plugin> [patch|minor|major]` (patch = fix/wording, minor = new behavior or arg, major = breaking) to bump `plugin.json` and the marketplace.json entry in lockstep (surgical, no other entry touched). If behavior changed, update the `description` in BOTH files (they differ: marketplace adds a portability suffix). Then commit the plugin's files plus the marketplace.json hunk and push (or open a PR per the recent worktree-branch history). A plugin edit that lands without the version bump + marketplace sync is incomplete; an edit that lands uncommitted is not shipped. The symlink keeps the Codex manifest version in lockstep automatically — `bump-plugin.sh` needs no Codex awareness. When you ADD or REMOVE a plugin (not just edit one), also run `scripts/sync-codex.sh` to rebuild the symlink + `.agents/plugins/marketplace.json`.

## Installing locally for testing

```
/plugin marketplace add /Users/victordsm/repos/personal/skills
/plugin install <plugin-name>@vdsmon-skills
```

After editing SKILL.md, reinstall or restart session — marketplace caches skill content.

For tight iteration without reinstalling, copy skill dir to `~/.claude/skills/<name>/` and edit in place — harness re-reads each session.