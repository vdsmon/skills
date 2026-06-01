# Fire-and-forget background pipeline

The `/flow spec` + `claude --bg "/flow do"` flow splits the pipeline at the PLANNING│IMPLEMENTING seam — the human/machine boundary.
You spec the work and review the PR; the machine owns everything between, unattended.

```
dev session, PLAN MODE
  /flow spec FT-X        fetch ticket + iterate plan (READ-ONLY)
  ExitPlanMode                                           ← THE one gate
       │ approved plan
       ▼
dev session, normal mode (post-approval)
  flow_worktree.py create …    worktree + config + mise trust + seed state + plan
  claude --bg "/flow do FT-X"  (cwd = worktree)          ← autonomous tail
       │
       ▼   implement → code_review → e2e → commit → create_pr → review_loop → reflect
  draft PR                                               ← you review
cockpit:  claude agents        manage 3–5 in flight (attach / peek / answer / detach)
```

Two human touchpoints: plan approval and PR review.
No mid-flight gate.

## Why a session, not a Workflow subagent

The per-ticket recipe is session-shaped (it IS `/flow do`, a slash skill).
A Workflow `agent()` is a subagent, and **subagents cannot invoke slash-command skills** — they would have to re-encode the recipe and drift.
`claude --bg` launches a full, detached session that runs the skill verbatim with its own context window.
Workflows still fit *under* a stage as a fan-out step; they do not replace the pipeline.

## What the bootstrap seeds (so the tail resumes at implement)

`flow_worktree.py create` marks the `plan` stage completed with the approved plan as its `plan.out`, and leaves `ticket` pending.
The backgrounded `/flow do`'s `init` resumes (idempotent, same `run_id`), `pick_next_pending` returns `ticket` (self-fetches ticket.json + stamps frontmatter), then skips the completed `plan` and lands on `implement`, which reads `plan.out`.

The bootstrap holds **no lease** — the bg session's `init` acquires it under the seeded `run_id`, so there is no foreign-lease conflict.

## Memory is shared, not per-worktree

Each ticket gets its own worktree, but the compounding-knowledge store must not fragment.
The bootstrap writes `[memory].root` into the worktree's `workspace.toml`, pointing at the **main checkout's** `.flow`.
So `reflect`'s `knowledge.jsonl` appends and `recall` reads all hit one store, serialized by the existing flock.
The modified `workspace.toml` stays unstaged — the commit stage's ownership gate only commits planned files, so it never reaches the PR.

## PR delivery

`create_pr` / `review_loop` default to `none`.
With `ship-it` installed, `/flow init --bundle recommended` auto-wires `create_pr → skill:ship-it:create` and `review_loop → skill:ship-it:feedback`, so the tail pushes + opens a draft PR + runs the CI/CodeRabbit loop.
ship-it's stack is Bitbucket + bkt + CodeRabbit; a GitHub-stack project supplies a different `create_pr` bundle.
A bare workspace ends at `commit` (committed branch, no PR).

## Blockers under `--bg`

A backgrounded session cannot answer `AskUserQuestion` live, so it **pauses** and surfaces as needs-input in `claude agents`.
Attach, answer, detach — the run resumes.
To minimize pauses, the bootstrap pre-populates the two frontmatter keys the tail's prose would otherwise ask for: `planned_files` (read by the implement pre-handler hook that records the diff baseline, and reused by the commit stage) and `commit_type` + `commit_summary` (read by the commit stage).
Other tail stages avoid prompts; any genuine ambiguity pauses rather than guessing.

## Closing the forget loop: auto-fire + `--notify`

Two independent pieces, gated independently.

**Auto-fire** is gated on a single marker in the **main checkout**, `.flow/.bg-autofire-enabled`.
Absent (default) → `/flow spec` prints the launch line and you fire it; this is how bg auth gets proven on ticket #1.
Present → spec runs the launch line itself (zero-touch).
Create the marker (`touch .flow/.bg-autofire-enabled`) only after one ticket has confirmed bg auth survives.
The marker lives in the main checkout and is read only by the spec session; it is not propagated into the worktree.

**`--notify`** is a flag spec appends to the launch line (`claude --bg "/flow do <KEY> --notify"`), so the tail pings you via the PushNotification tool: once when the PR is genuinely review-ready — after `review_loop` goes green (CI passed and every actionable reviewer thread resolved), not when the draft first opens at `create_pr` — carrying the PR URL (the heart of "forget", the signal to come review); and best-effort right before a blocker (it pushes, then raises `AskUserQuestion`, which pauses the bg session).
PushNotification is harness-local (terminal + phone via Remote Control), so it does **not** ride MCP/claude.ai auth — it fires even if the tail's tracker calls 401, which is exactly how you learn an unattended run stalled on auth.
That is why notify is not gated with auto-fire: it is the safety signal for the very risk auto-fire is gated on.

## Validate before scaling (open risks)

- **bg MCP auth.** `--bg` inherits cached keychain creds, but a claude.ai OAuth token refresh can require a browser and 401 silently.
  Run ONE ticket end-to-end and confirm the tracker calls (ticket fetch, transition, is-shipped) succeed before firing 3–5.
  Fallback: an interactive tmux session has live auth.
- **mise/toolchain.** The bootstrap only `mise trust`s; the first `mise run` in the tail installs the toolchain.
  If your repo's setup races a lock (e.g. `uv venv --seed` on the uv cache), validate the first run.
- **skill-launched `claude --bg` (the auto-fire path).** When the marker is set, spec fires the launch line from its **own** Bash tool (claude-in-claude), not from your shell.
  Fire it as a **foreground** Bash call — `claude --bg` already self-detaches and returns immediately, so wrapping it in `run_in_background` double-backgrounds it: the launcher becomes its own tracked bg task (spurious completion ping) and the pipeline ends up in a nested session you have to chase.
  Confirm that path spawns a working detached session you can see in `claude agents` — it is a different path than you firing it manually, and it is the one the marker enables.
  Until confirmed, leave the marker off and fire manually.
- **PushNotification from a detached session.** The `--notify` pings come from a `--bg` session with no attached terminal, so the desktop path has nothing to render to; the phone push needs Remote Control connected.
  Confirm a ping actually reaches you from one real bg run before trusting `--notify` as your only signal that the tail landed or stalled.
- **git push permission.** The unattended tail pushes at `create_pr` (ship-it). If `git push` is gated — an `ask` permission rule, or a global "never push without explicit permission" instruction — the auto-mode classifier denies it in a `--bg` session and the tail stalls at create_pr with no way to grant it unattended.
  Pre-authorize a feature-branch push before relying on the tail: a `Bash(git push:*)` allow-rule (force-push still denied via a `deny` guard), and make any global push instruction recognize that an explicitly-invoked pipeline push is fine. Confirm a real bg push lands before flipping `.bg-autofire-enabled`.

"Confirmed on ticket #1" (the bar for flipping `.bg-autofire-enabled` on) means all five: handoff composes, bg MCP auth survives, skill-launched `--bg` works, git push is pre-authorized, and a notify ping arrives.
