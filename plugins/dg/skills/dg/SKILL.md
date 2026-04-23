---
name: dg
description: >-
  Runs adversarial code review as Dinesh vs Gilfoyle banter from HBO's
  Silicon Valley. Two Agent-tool personas debate the diff across capped
  rounds — Gilfoyle attacks with technical precision, Dinesh defends with
  flustered competence — then converge on a verdict with Critical,
  Important, Contested, and Dismissed buckets plus a recommended-changes
  checklist.
when_to_use: >-
  Use when the user invokes `/dg`, `/dg <rounds>`, `/dg <path>`, or
  `/dg <rounds> <path>`. Also surface when the user wants an entertaining
  adversarial review of a diff or file, or says "review this with dg",
  "dinesh gilfoyle review", or similar.
argument-hint: "[rounds] [path]"
disable-model-invocation: true
allowed-tools:
  - Bash(git diff *)
  - Bash(git status *)
---

# Dinesh vs Gilfoyle Code Review

Two-agent adversarial review. Gilfoyle attacks with technical precision, Dinesh defends with flustered competence. Banter entertains; the debate produces better reviews.

## Invocation

- `/dg` — review git diff (staged + unstaged)
- `/dg 3` — git diff, cap 3 rounds
- `/dg src/auth.ts` — review specific path
- `/dg src/auth.ts 3` — path + cap

## Parse Arguments

Raw input: `$ARGUMENTS`

Split on whitespace. Tokens: `<integer>` = round cap, anything else = target path. Order doesn't matter. Defaults: target = git diff, cap = 5. Empty input = defaults.

## Step 1 — Gather Code

**git diff target:**
```bash
git diff HEAD
git diff --staged
```
Both empty → stop, tell user nothing to review.

**path target:** Read file(s). Directory → read source files recursively.

Gilfoyle runs his own dependency audit via Bash in Round 1. No pre-fetch needed.

## Step 2 — Run the Debate

Init: `round = 0`, `debate_history = []`.

Per round:

1. **Dispatch Gilfoyle** (Agent tool, `general-purpose`). Pass: full `gilfoyle-agent.md` content, code under review, debate history, round number. Add: "Research only. Do NOT edit files."
2. Display Gilfoyle's BANTER.
3. Converge if every FINDINGS entry repeats from prior rounds.
4. **Dispatch Dinesh** (Agent tool, `general-purpose`). Pass: full `dinesh-agent.md` content, code, Gilfoyle's latest full response, history, round. Add: "Research only. Do NOT edit files."
5. Display Dinesh's BANTER.
6. Converge if every FINDINGS entry is `[concede]` (no `[defend]` / `[dismiss]`).
7. Append both responses to history, `round += 1`.
8. `round >= cap` → ask *"These two could go all night. Continue? (y/N)"*. Yes → extend cap by original amount. No → synthesize.

Convergence line (pick one that fits):
- "Gilfoyle has run out of things to hate. Unprecedented."
- "Dinesh has conceded defeat. As expected."
- "These two are going in circles. Separating them before it gets physical."

## Step 3 — Synthesize

```markdown
## Dinesh vs Gilfoyle Review — [target]
### [N] rounds of mass destruction

### Best of the Banter
[2–4 sharpest or funniest exchanges]

### Verdict

#### Critical (Dinesh conceded)
- `file:line` — issue — fix

#### Important (Gilfoyle won after debate)
- `file:line` — issue — fix

#### Contested (Dinesh held ground)
- `file:line` — issue raised — why defense holds

#### Dismissed (nitpick)
- `file:line` — issue raised — why it's a non-issue

### Strengths
[Things even Gilfoyle grudgingly acknowledged]

### Score
Gilfoyle: X | Dinesh: Y

### Recommended Changes
- [ ] `file:line` — change
```

No changes → "Nothing to fix. Gilfoyle is furious."

Recommended Changes = union of Critical + Important, flattened. No repeats.

## Principles

- Banter is the feature, not decoration.
- Dinesh's concessions = strongest signal of real issues.
- Successful defenses validate code.
- Technical substance must be real — humor only works if the calls are correct.
- Always end with actionable summary.
