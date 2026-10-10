# cc-autotitle: a mod that names sessions on its own

Status: design, waiting for review. Replaces the `cc-session-name` plugin.

## Goal

Stop typing `/rename`. Today you ask the `session-name` skill for a name and paste the `/rename` line it prints (12 times in 18 days). The mod gives every interactive session the same kind of name the skill gives: kebab-case, English, with the handles you search for in `/resume` (ticket keys, PR numbers, batch ids), picked from the whole session.

What you said:

- Name early, then follow drift: sessions change focus (3 of 43 renamed sessions in 30 days got a second name on a new subject, e.g. `backoffice-pipeline-findings -> google-top-10`).
- Never touch a name you set by hand.
- Use `$.model.fork`, not a Haiku call over a slice of the transcript.
- A mod command replaces the skill; the plugin becomes mod-only.
- Apply the name with `sessionTitle` (chosen after the spike below).
- Rename the plugin.

What I assumed (correct me):

- Name: `cc-autotitle`, command `/autotitle`. "Title" is Claude Code's own word for it (`sessionTitle`, `custom-title`, `ai-title`), and it covers the first name and later renames; "auto-rename" sounds like it only redoes names.
- It ships as a new plugin at 1.0.0 and `cc-session-name` is removed, the same way `cc-keepwarm` replaced `cc-cache-keepalive`.

## Spike results

Throwaway mod in a Haiku session on Claude Code 2.1.296 (recorded as `docs/experiments.md` #21):

- `classic.UserPromptSubmit` returning `sessionTitle` writes a `custom-title` record, the same record `/rename` writes. It adds nothing to the transcript and nothing to the model's context. It lands on the prompt whose hook returns it.
- `$.command.run({ command: 'rename', args })` also writes `custom-title`, but adds the `/rename` lines and the reminder "The user named this session x" to the model's context. From `classic.Stop` it is refused ("would wait on the turn this hook is holding"); from `turn.complete` it works.
- The hook input `session_title` is empty until a `custom-title` exists. The built-in `ai-title` (every session gets one) does not count.
- `sessionTitle` overwrites a name set by hand, so the mod must check before it applies one.
- A `command.run` hook on `rename` sees `origin: { kind: 'composer' }` for a typed `/rename` and `{ kind: 'plugin', name }` for a mod's.

## Behaviour

### When it checks

On `turn.complete` for the main thread (`agentId` undefined, `reason: 'answer'`), in an interactive session only, the mod counts the turn and checks whether a name check is due:

- First check: at turn `firstAfterTurns` (default 3). Before that the built-in `ai-title` is enough, and the session has not shown its subject yet.
- Re-check: `recheckEveryTurns` (default 10) turns after the last good check, or on the first turn after a compaction (`classic.PostCompact` on the main thread sets a flag).
- Never when the name is pinned, auto-naming is off, or a check is already running.

A due check starts a fork from `$.clock.after(0, …)`, so the turn ends at once and the fork is not tied to that turn. The fork runs right after a request, so the transcript is still in the cache.

### How it picks

The fork prompt carries the rules from today's skill: lead with the subject, then the action or result; keep searchable handles; drop filler words and the repo name; lowercase English; 2 to 6 words; under about 40 characters; weigh where the work went, not the last turn. It names the current name, if any, and asks for that same name back when it still fits, so a session keeps its name unless the main work moved. It asks for the name alone, at once, without thinking (the same wording cut a keepwarm ping from about 85 to 4 output tokens, experiment #20).

The reply is trimmed and checked against `^[a-z0-9]+(-[a-z0-9]+){1,5}$`, 40 characters at most. Anything else is thrown away.

A good reply that differs from the current name becomes `pending`.

### How it applies

On the next `classic.UserPromptSubmit` the mod stores `e.session_title` as `lastSeen`, then:

1. If `e.session_title` is set and is not `lastSet`, someone else named the session: you with `/rename`, another surface, or a session resumed with a name. Set `pinned`, drop `pending`, apply nothing.
2. Else, if `pending` is set and differs from `e.session_title`, return `{ ...await next(e), sessionTitle: pending }` and store it as `lastSet`.

So the name lands with your next prompt. A check after the last turn of a session never lands; that is fine, since a session that ended does not drift.

### Command

`/autotitle`, registered on `session.start`:

| Call | What it does |
| --- | --- |
| `/autotitle` | Picks a name now and applies it at once |
| `/autotitle <hint>` | Same, with the hint in the fork prompt ("focus on the PR part") |
| `/autotitle off` / `on` | Pauses or resumes auto-naming in this session; `on` also clears `pinned` and takes the current name (`lastSeen`) as `lastSet`, so the next prompt does not pin it again |
| `/autotitle status` | State (on, off or pinned), the last name it set, the turn of the next check, and counts of checks, renames and failures |

A name from `/autotitle` is applied with `$.command.run({ command: 'rename', args })`, since the "user named this session" reminder is true here. It counts as yours: it sets `lastSet` to that name and sets `pinned`. Before the first response there is nothing to fork; the command answers "Nothing to name yet."

### Failure

The rule: when unsure, keep the current name. A wrong name is worse than an old one, because you search `/resume` by name.

- A fork that fails (`api-error`, `empty-reply`, `aborted`) or a reply that fails the check: no rename, and the check stays due, so the next turn tries again. After 3 failures in a row the mod waits for the next scheduled check.
- `nothing-to-fork` (after `/clear`): no rename; the count starts again from the next turn.
- Bookkeeping errors are caught; no hook may break the turn or the prompt it rides on.
- `claude -p` and SDK runs (`isInteractive: false`) never check.

### Settings

`userConfig` in `plugin.json`, set in `/config`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `firstAfterTurns` | 3 | Turn of the first check |
| `recheckEveryTurns` | 10 | Turns between re-checks; 0 names once and never re-checks |

### State

Atoms under the plugin key, as in cc-keepwarm: `turns`, `lastCheckTurn`, `compacted`, `pending`, `lastSet`, `lastSeen`, `pinned`, `isOff`, `failures`, `stats`. One in-flight flag lives in module memory.

Atoms are lost on resume, so `lastSet` and `pinned` are also saved in `$.store` under `s:<session id>` with a timestamp, and loaded on `session.start`. A resumed session then keeps following drift, and a pinned one stays pinned. Entries older than 60 days are pruned on `session.start`.

## What it costs

One fork per check: the cached prefix plus the prompt, and about 10 output tokens. On Max, cache reads do not count toward quota (experiment #1). On API billing a fork on a 480k-token session reads about $0.10 of cache. A 30-turn session has about 3 checks.

## Out of scope

- Haiku over a transcript slice (rejected: it sees only part of the session).
- A visible notice when the name changes. The title in the prompt box border already shows it.
- Naming subagent or `-p` sessions.

## Testing

- `plugins/cc-autotitle/hooks/autotitle.test.ts` through `claude plugin test`, with a mocked clock and fork, like cc-keepwarm. Cases: first check at turn 3 and none before; re-check at turn 13 and after a compaction; a reply equal to the current name applies nothing; a bad reply applies nothing and retries; 3 failures wait for the next check; a manual name pins; `/autotitle` pins; `off` and `on`; non-interactive does nothing; subagent turns do not count.
- `mise run test:autotitle` runs validate and the tests; it needs the `claude` CLI, so CI does not run it.
- Live check: run the mod for a day of real sessions, then compare its names with the names you would have picked. Record the result as an experiments row.

## Shipping

- New `plugins/cc-autotitle/` (`plugin.json` at 1.0.0 with `types` and `userConfig`, `hooks/hooks.json`, `hooks/register.ts`, `types/index.d.ts`, the test, a `README.md`, since a hook-only plugin may ship one).
- Remove `plugins/cc-session-name/` and its marketplace entry; `mise run sync` updates the README table.
- `mise.toml`: a `test:autotitle` task. `CLAUDE.md`: name it beside `test:keepwarm`.

## Checks during the build

- Whether `$.model.fork` and `$.command.run` are allowed inside a `command.run` hook. If `$.command.run` is refused there, `/autotitle` sets `pending` and answers "Renames to x with your next message".
