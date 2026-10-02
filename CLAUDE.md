# CLAUDE.md

Guidance for Claude Code when it works in this repo.

## Repository purpose

`vdsmon/skills` is a personal plugin marketplace for Claude Code and Codex. Each skill ships as its own plugin, so users install only what they want. There is no build and no package manager: plugins are Markdown skills, plus helper scripts and shell hooks where a plugin needs them.

## Layout and the marketplace contract

```
.claude-plugin/marketplace.json     # Claude Code marketplace: one entry per plugin
.agents/plugins/marketplace.json    # Codex marketplace: GENERATED, non-cc- plugins only
plugins/<plugin>/
  .claude-plugin/plugin.json        # Manifest (name, version, description, hooks): source of truth
  .codex-plugin -> .claude-plugin   # GENERATED symlink, non-cc- only; Codex reads .codex-plugin/plugin.json
  skills/<skill>/SKILL.md           # Skill prompt with YAML frontmatter
  skills/<skill>/agents/openai.yaml # GENERATED for user-only skills of non-cc- plugins
  skills/<skill>/scripts/*          # Optional helper scripts the skill calls
  hooks/*.sh                        # Optional event hooks declared in plugin.json (cc- only)
  tests/test-*.sh                   # Optional offline test suite; tests/live-*.sh spend tokens
scripts/                            # sync-codex.sh, bump-plugin.sh, check.py, test-offline.sh
docs/                               # Repo notes that never ship, e.g. docs/experiments.md
evals/<skill>/                      # Eval fixtures kept out of the shipped plugin; point skill-smith at them by path
```

You author `plugin.json` and the skills. `scripts/sync-codex.sh` (`mise run sync`) derives the rest, so never hand-edit a generated file:

- Each marketplace entry's `description` and `version` come from its `plugin.json`. The description gets one host note appended: "Portable across SKILL.md-native hosts." or, for cc- plugins, "Claude Code only." Write the description in `plugin.json` only, with no host note.
- `.codex-plugin` is a symlink to `.claude-plugin` (git mode 120000), so each plugin has exactly one `plugin.json` and the two hosts cannot drift.
- `.agents/plugins/marketplace.json` is the Claude marketplace minus cc- plugins, remapped to Codex's `source`/`policy`/`category` shape.
- `agents/openai.yaml` sets `policy.allow_implicit_invocation: false` for every non-cc- skill with `disable-model-invocation: true`. Codex ignores that frontmatter flag; the file hides the skill from Codex's model listing, and an explicit `$skill` call still works.
- The README plugin table: whole sentences of each `plugin.json` description, up to 170 chars.

cc- plugins are Claude-Code-only (hooks, `` !`cmd` `` injection, `${CLAUDE_SKILL_DIR}`, `claude -p`, session-JSONL parsing). They get no `.codex-plugin` symlink and no Codex marketplace entry. Unprefixed plugins must work on any Agent Skills host.

To add, rename or remove a plugin, or to flip its cc- prefix: the dir name, the `plugin.json` `name` and the marketplace entry's `name` must match, and the entry needs `source: ./plugins/<name>`. Then run `mise run sync` and commit what it changes. A skill's dir name under `skills/` is independent but usually matches.

## Checks and tests

- `mise run verify` runs sync, fails if a generated file changed, then runs `scripts/check.py`. check.py fails on a broken contract (above), a description over its cap, `when_to_use` on a user-only skill, a cc- feature in an unprefixed plugin, or prep-compact's and prep-exit's `baseline.sh` copies differing (change both together). It warns on a SKILL.md over 100 lines.
- `mise run test` runs every offline suite (`plugins/*/tests/test-*.sh`). Run the suite of any plugin whose hooks or scripts you touch.
- CI (`.github/workflows/ci.yml`, on macOS because the hooks use BSD `stat` and `date`) runs sync, check.py and the offline suites on every pull request and on main.
- `mise run test:keepalive-live` is a live test: it spends tokens, so CI never runs it. Re-run it after a Claude Code upgrade, because it covers a failure that is silent and only shows up on the bill.

## Anatomy of a skill

Frontmatter fields that change behavior:

- `name`: the slug that invokes the skill.
- `description`: what the skill does and when to use it, third person, 280 chars or fewer. Codex and other hosts read only this field, so name each distinct trigger once here.
- `when_to_use`: extra trigger phrases, appended to the description in Claude Code's listing (shared 1,536-char cap). It is ignored on `disable-model-invocation` skills; omit it there.
- `argument-hint` / `arguments`: autocomplete hint and named positional args for `$ARGUMENTS` / `$N` / `$name`.
- `allowed-tools`: pre-approved tool patterns (see `humanize`).
- `paths`: glob gate; auto-trigger only when matching files are open.
- `context: fork` + `agent`: run the skill in an isolated subagent.
- `disable-model-invocation: true`: user-only; it fires only on an explicit `/slash` call (on Codex, `$skill`, enforced by the generated `openai.yaml`).
- `user-invocable: false`: hidden from the `/` menu (background knowledge only).

Invocation policy: make misfire-prone or token-heavy skills user-only, so they fire only on an explicit call. Keep proactive guardrails (e.g. `brainstorming`) and friction-catchers (e.g. `skill-polish`) model-invocable. An edit or confirm gate inside the skill flow is not a reason to also block auto-fire.

The body is a prompt, not docs: second-person imperative. Keep this file and every SKILL.md concise, because each token is re-cached on every prefix invalidation.

**Plugin description** (`plugin.json`): the first sentence must stand alone in 170 chars or fewer, because it becomes the README row. The whole description is 300 chars or fewer. Mechanics go in SKILL.md, not the description.

**Progressive disclosure**: move reference content out of SKILL.md into sibling files (see `plugins/skill-smith/skills/skill-smith/references/`). Keep references one level deep: chains of `.md` -> `.md` -> `.md` cause partial reads. Aim for 100 lines or fewer in SKILL.md.

**Helper scripts**: put deterministic logic in `skills/<skill>/scripts/` and have the skill call it (e.g. prep-compact's `scripts/baseline.sh`). Otherwise the model re-interprets the prose on every run.

**Dynamic context injection** (cc- only): `` !`cmd` `` inline or `` ```! `` fenced blocks in the skill body run shell commands, and their output replaces the placeholder before the model reads the skill. Use `${CLAUDE_SKILL_DIR}` for script paths, `$ARGUMENTS` / `$0` for user args.

**ultrathink**: the literal word `ultrathink` anywhere in the skill body switches on extended thinking for the turn when the skill fires. Use it on purpose, for analysis-heavy skills.

## Hooks

Hooks are cc- only. Rules for any new hook:

- **Opt-in.** A hook must not spend tokens or schedule work on its own. Put that behind an explicit user action, such as a user-only skill (e.g. `/cc-cache-keepalive`). An always-on hook treats installing as the opt-in; give it an env kill switch, named like cc-cache-keepalive's `CC_KEEPALIVE_OFF=1`.
- **Output.** Hook stdout becomes a system reminder. Wrap it in a `<name-of-hook>` XML tag.
- **Measure directive wording.** A hook that only asks the model to do something must have its wording measured, not guessed. Given an ordinary first prompt, a model answers the user and skips the aside: the keepalive directive scored 0/8 that way, created no cron at all, and showed no error. Lead with `REQUIRED SETUP`, order the steps ahead of the user's request, and keep it terse (a "why it matters" paragraph diluted it again). Re-measure any rewording with a live run, as `docs/experiments.md` #18 did.
- **State.** Keep it under `~/.claude/.<plugin>/`, keyed by `session_id`. One unkeyed shared file leaks one session's state into another.
- **Exit codes.** Use `set -u`, never `set -eu`, and an explicit `exit 0` on every path. A `Stop` hook that exits 2 blocks stopping; a `UserPromptSubmit` hook that exits non-zero errors on every prompt.
- **Fail open, and write down which way that points** in a comment. For the keepalive pair, a wasted ping is cheap and a cold cache is not, so the guard matches the sentinel strictly (a false positive would block a real prompt) and the sensor matches loosely (a false positive costs one ping). Copying a similar hook verbatim gets this backwards.
- **`Stop`, never `SubagentStop`**, for a hook that should fire once per main-agent turn. `Stop` carries no `agent_id`, so it already fires for the main agent only.
- **Record measurements** (cache TTLs, billing, directive compliance) as rows in `docs/experiments.md`, not in new notes.

## Upstream-derived plugins

These plugins started as copies of other repos. Re-sync them from upstream from time to time: re-apply the local changes, and name the source in the commit body as `synced from <repo>@<sha> (<version>)`, so the next re-sync starts from a clean diff.

- `mattpocock/skills`: grilling, codebase-design, teach, and skill-smith's design vocabulary (`references/skill-design-*.md`).
- `obra/superpowers`: brainstorming, systematic-debugging, and skill-smith's TDD-for-skills discipline (from writing-skills).
- `anthropics/skills`: skill-smith's eval harness (from skill-creator).

## Shipping a change

- Every plugin change ships in the same pull request as its version bump: `mise run bump <plugin> [patch|minor|major]` (patch = fix or wording, minor = new behavior, new option or removed feature, major = breaking). Then run `mise run sync` and commit the plugin files together with the generated changes. A plugin edit without a bump is incomplete.
- Work on a branch and open a pull request. Never push to main.
- No docs inside plugins: SKILL.md is the prompt, and separate docs rot and cost context. One exception: a hook-only plugin may ship one `README.md`, since it has no SKILL.md to explain opt-in and config. Research notes, retros and experiment logs never ship; put them under `docs/` or another folder outside `plugins/`.

## Installing locally for testing

```
/plugin marketplace add /Users/victordsm/repos/personal/skills
/plugin install <plugin-name>@vdsmon-skills
```

After you edit a SKILL.md, reinstall or restart the session: the marketplace caches skill content.

For tight iteration without reinstalling, copy the skill dir to `~/.claude/skills/<name>/` and edit it there; the harness re-reads it each session.
