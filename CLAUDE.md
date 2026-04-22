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

Current plugins: `skill-polish`, `tokenomics`, `pre-compact`, `humanize`, `dg`.

## Anatomy of a skill

`SKILL.md` frontmatter fields affect behavior:

- `name` — slug to invoke skill
- `description` — trigger phrases; Claude Code matches against user intent, must enumerate phrasings that activate skill
- `user-invocable: true` — user call as slash command (see `tokenomics`)
- `allowed-tools` — optional whitelist (see `humanize`)
- `version` — optional; most skills omit, rely on plugin.json version

Body = prompt, not docs. Write instructions to model in second-person imperative. Keep CLAUDE.md concision: every token re-cached on prefix invalidation.

**Multi-file skills**: skill dir may contain extra `.md` files alongside `SKILL.md`. Orchestrator `SKILL.md` reads siblings, passes content to dispatched `Agent` tool calls (see `dg`'s `dinesh-agent.md` + `gilfoyle-agent.md`). Sibling paths relative to skill dir.

## Hooks (only tokenomics uses one)

`plugins/tokenomics/.claude-plugin/plugin.json` declares `SessionStart` hook running `hooks/tokenomics-keepalive.sh`. Pattern preserve when adding hooks:

- **Opt-in via flag file in `$HOME`** (`~/.tokenomics-keepalive`). Hook short-circuits with `exit 0` when flag absent — zero output, zero side effects for non-opt-in users.
- **Flag file doubles as config**: first line overrides default interval, regex-validated with fallback.
- **Hook emits instruction inside `<name-of-hook>` XML tag to stdout.** Claude Code injects stdout as system reminder; model sees as directive to run `/loop <interval> python3 <script>`.

When editing `tokenomics-keepalive.sh`, keep explicit `/loop` boilerplate-suppression note — default `/loop` confirmation line noise in auto-scheduled flow.

## The one script: `token-report.py`

`plugins/tokenomics/skills/tokenomics/scripts/token-report.py` self-contained Python 3 (stdlib only, no deps). Three data sources:

1. Session JSONL transcripts at `~/.claude/projects/<mangled-cwd>/*.jsonl` — parses `assistant` events for `usage` blocks.
2. Plan usage from `https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20`, using OAuth token from macOS Keychain (`security find-generic-password -s "Claude Code-credentials"`). Keychain-only — breaks on Linux.
3. Per-file state cache `<session>.jsonl.tokenomics-state.json` for delta tracking.

Run directly: `python3 plugins/tokenomics/skills/tokenomics/scripts/token-report.py [--all|<path>]`. SKILL.md documents keepalive-loop findings (verified 30m interval, 60m fails due to 1h TTL + jitter) — update table when running new experiments rather than write new doc.

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