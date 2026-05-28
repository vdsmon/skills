# Fire-and-forget background pipeline

The `/flow spec` + `claude --bg "/flow do"` flow splits the pipeline at the
PLANNING│IMPLEMENTING seam — the human/machine boundary. You spec the work and
review the PR; the machine owns everything between, unattended.

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

Two human touchpoints: plan approval and PR review. No mid-flight gate.

## Why a session, not a Workflow subagent

The per-ticket recipe is session-shaped (it IS `/flow do`, a slash skill). A
Workflow `agent()` is a subagent, and **subagents cannot invoke slash-command
skills** — they would have to re-encode the recipe and drift. `claude --bg`
launches a full, detached session that runs the skill verbatim with its own
context window. Workflows still fit *under* a stage as a fan-out step; they do
not replace the pipeline.

## What the bootstrap seeds (so the tail resumes at implement)

`flow_worktree.py create` marks the `plan` stage completed with the approved
plan as its `plan.out`, and leaves `ticket` pending. The backgrounded
`/flow do`'s `init` resumes (idempotent, same `run_id`), `pick_next_pending`
returns `ticket` (self-fetches ticket.json + stamps frontmatter), then skips the
completed `plan` and lands on `implement`, which reads `plan.out`.

The bootstrap holds **no lease** — the bg session's `init` acquires it under the
seeded `run_id`, so there is no foreign-lease conflict.

## Memory is shared, not per-worktree

Each ticket gets its own worktree, but the compounding-knowledge store must not
fragment. The bootstrap writes `[memory].root` into the worktree's
`workspace.toml`, pointing at the **main checkout's** `.flow`. So `reflect`'s
`knowledge.jsonl` appends and `recall` reads all hit one store, serialized by the
existing flock. The modified `workspace.toml` stays unstaged — the commit stage's
ownership gate only commits planned files, so it never reaches the PR.

## PR delivery

`create_pr` / `review_loop` default to `none`. With `ship-it` installed,
`/flow init --bundle recommended` auto-wires `create_pr → skill:ship-it:create`
and `review_loop → skill:ship-it:feedback`, so the tail pushes + opens a draft PR
+ runs the CI/CodeRabbit loop. ship-it's stack is Bitbucket + bkt + CodeRabbit; a
GitHub-stack project supplies a different `create_pr` bundle. A bare workspace
ends at `commit` (committed branch, no PR).

## Blockers under `--bg`

A backgrounded session cannot answer `AskUserQuestion` live, so it **pauses** and
surfaces as needs-input in `claude agents`. Attach, answer, detach — the run
resumes. To minimize pauses, the bootstrap pre-populates the two frontmatter keys
the tail's prose would otherwise ask for: `planned_files` (read by the implement
pre-handler hook that records the diff baseline, and reused by the commit stage)
and `commit_type` + `commit_summary` (read by the commit stage). Other tail stages
avoid prompts; any genuine ambiguity pauses rather than guessing.

## Validate before scaling (open risks)

- **bg MCP auth.** `--bg` inherits cached keychain creds, but a claude.ai OAuth
  token refresh can require a browser and 401 silently. Run ONE ticket end-to-end
  and confirm the tracker calls (ticket fetch, transition, is-shipped) succeed
  before firing 3–5. Fallback: an interactive tmux session has live auth.
- **mise/toolchain.** The bootstrap only `mise trust`s; the first `mise run` in
  the tail installs the toolchain. If your repo's setup races a lock (e.g.
  `uv venv --seed` on the uv cache), validate the first run.
