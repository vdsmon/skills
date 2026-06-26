---
name: skill-smith
argument-hint: "[skill name or what to build]"
disable-model-invocation: true
description: Create, test, evaluate, optimize triggering, and package Agent Skills. Use whenever the user wants to build a skill from scratch, turn a workflow into a skill, improve or debug an existing skill, run evals or benchmarks on a skill, raise a skill's triggering accuracy, or package a skill for install. Carries TDD-for-skills discipline, baseline-test first, close rationalization loopholes, verify empirically before shipping.
---

# Skill Smith

A forge for Agent Skills. Two disciplines in one tool:

1. **Empirical loop:** run the skill against a baseline, benchmark the difference, iterate on evidence (not vibes).
2. **TDD-for-skills:** you don't know a skill teaches the right thing until you've watched an agent fail *without* it first.

These are the same loop. The sections below run it end to end: capture intent -> draft -> test -> improve -> optimize description -> package.

## Core principle: writing a skill IS TDD for process documentation

RED-GREEN-REFACTOR maps directly onto the empirical eval loop:

| TDD phase | Skill work |
|-----------|------------|
| **RED:** write a failing test, watch it fail | Run the task **without** the skill (baseline). Capture what the agent does naturally and its exact rationalizations. |
| **GREEN:** minimal code to pass | Write the minimal skill that fixes *those specific* failures. Run **with** the skill. Agent now complies. |
| **REFACTOR:** clean up, stay green | Agent finds a new loophole -> add an explicit counter -> re-test until bulletproof. |

**The Iron Law:** no skill (and no *edit* to a skill) ships without a baseline you watched fail first. If you didn't see the agent fail without it, you don't know the skill prevents the right failure. This applies to "simple additions" and "just a doc tweak" too.

The rest of this skill is how to run RED-GREEN-REFACTOR rigorously, with real measurement.

## Find where the user is in the loop

The user may arrive anywhere: "I want a skill for X" (start at intent), "here's a draft" (jump to test), "is the new version better?" (jump to blind comparison), "it keeps not triggering" (jump to description optimization). Figure out where they are and join there. Be flexible: if they say "skip the evals, just vibe with me," do that.

Use TodoWrite to track the stages so you don't drop the eval-viewer or description-optimization steps.

## Communicating with the user

Skill authors range from career engineers to first-time terminal users. Read context cues. "Evaluation" / "benchmark" are usually fine; for "JSON" / "assertion" wait for signals they know the terms, or define them in a clause. Briefly explain a term when in doubt.

---

## 1. Capture intent

If the current conversation already contains the workflow to capture ("turn this into a skill"), mine it first: tools used, the step sequence, corrections the user made, observed input/output formats. Then confirm the gaps:

1. What should this skill let the agent do?
2. When should it trigger? (what phrases / contexts)
3. Expected output format?
4. Does it need test cases? Objectively-verifiable outputs (file transforms, extraction, codegen, fixed workflows) benefit from them. Subjective outputs (writing style, design) usually don't. Evaluate those qualitatively. Suggest a default, let the user decide.

Proactively ask about edge cases, example files, success criteria, dependencies before writing test prompts. Use MCPs/subagents to research similar skills or domain docs in parallel so you arrive with context.

## 2. Write the draft

### Anatomy

```
skill-name/
├── SKILL.md            # required: YAML frontmatter + instructions
└── (optional)
    ├── scripts/        # deterministic/repetitive work; can run without loading into context
    ├── references/     # docs loaded on demand
    └── assets/         # files used in output (templates, fonts)
```

**Progressive disclosure (three load levels):**
1. **Metadata** (name + description, ~100 words), always in context.
2. **SKILL.md body** (<500 lines ideal), in context whenever the skill triggers.
3. **Bundled resources:** pulled only when needed (scripts can execute without loading).

Keep SKILL.md under ~500 lines; approaching that, add a layer of hierarchy with a clear pointer to the reference file. For reference files >300 lines, add a table of contents. When a skill spans variants (aws/gcp/azure), put the workflow + selection in SKILL.md and one reference file per variant.

### The description field: the primary trigger

The description is what the agent reads to decide whether to load the skill. Two forces pull on it, and the resolution is the heart of this merge:

- **Trigger-focused, not a workflow summary.** If the description summarizes the *process*, the agent tends to follow the summary and skip reading the body. A description saying "review between tasks" once caused a *single* review even though the body specified two. So: describe *when to use*, with concrete symptoms and contexts, not the steps.
- **Pushy on coverage.** Agents *under*-trigger skills. Cover varied phrasings, casual and formal, and cases where the user needs the skill without naming it. Lean toward triggering.

These don't conflict: be expansive about *when*, restrained about *how*. And you don't have to settle it by taste, because Step 5 optimizes the description **empirically** against trigger evals.

Write the description in third person. Keep frontmatter (name + description) under 1024 chars; name uses letters/numbers/hyphens only.

### Skill types (they drive how you test, in Step 3)

- **Technique:** concrete method with steps (`condition-based-waiting`, `root-cause-tracing`).
- **Pattern:** a way of thinking (`flatten-with-flags`).
- **Reference:** API/syntax/command docs.
- **Discipline:** a rule the agent must hold under pressure (TDD, verification-before-completion). These need anti-rationalization hardening (see "Hardening discipline skills" below).

### Writing patterns

Imperative voice. Explain the **why** behind each instruction, because today's models have good theory of mind and a reason generalizes where a rigid MUST does not. If you're writing ALL-CAPS MUST/NEVER or fill-in-the-blank templates, that's a yellow flag: reframe and explain instead. One excellent, runnable, well-commented example beats five mediocre multi-language ones. No narrative ("in session 2025-10-03 we..."). Skills are reusable references, not war stories.

For the design vocabulary behind these patterns, **predictability** as the root virtue, **context load** vs **cognitive load** when deciding model- vs user-invocation, the **information hierarchy** ladder (step -> in-file reference -> disclosed reference), **leading words**, and the failure modes to diagnose against in Step 4 (premature completion, duplication, sediment, sprawl, no-op), see `references/skill-design-principles.md` (terms defined in `references/skill-design-glossary.md`).

## 3. Test and evaluate (the empirical harness)

This is one continuous sequence, so don't stop partway. Put results in `<skill-name>-workspace/` beside the skill, organized `iteration-N/eval-<id>/`. Create directories as you go.

### Step 3.1: Spawn with-skill AND baseline runs in the same turn

For each test case, launch two subagents at once:

**With-skill:**
```
Execute this task:
- Skill path: <path-to-skill>
- Task: <eval prompt>
- Input files: <eval files, or "none">
- Save outputs to: <workspace>/iteration-<N>/eval-<ID>/with_skill/outputs/
- Outputs to save: <what the user cares about>
```

**Baseline** (this is your RED):
- **New skill** -> no skill at all, same prompt, save to `without_skill/outputs/`.
- **Improving a skill** -> snapshot first (`cp -r <skill-path> <workspace>/skill-snapshot/`), point the baseline at the snapshot, save to `old_skill/outputs/`.

Write `eval_metadata.json` per case (`eval_id`, `eval_name` (descriptive, not "eval-0"), `prompt`, `assertions: []` for now).

### Step 3.2: While runs are in flight, draft assertions

Good assertions are objectively verifiable with descriptive names that read clearly in the viewer. Don't force assertions onto subjective skills. Evaluate those qualitatively. Save assertions into `evals/evals.json` and the per-eval metadata. See `references/schemas.md` for exact schemas.

### Step 3.3: Capture timing as each run completes

Each subagent completion notification carries `total_tokens` and `duration_ms`. This is the **only** time you get them. Save immediately to `timing.json` in the run dir.

### Step 3.4: Grade, aggregate, view

1. **Grade:** spawn a grader (read `agents/grader.md`) or grade inline; write `grading.json` per run using fields `text`, `passed`, `evidence` (the viewer depends on these exact names). Script anything checkable programmatically.
2. **Aggregate:** from this skill's directory: `python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>` -> `benchmark.json` + `benchmark.md` (pass_rate, time, tokens; mean ± stddev + delta).
3. **Analyst pass:** read the benchmark for what the aggregate hides (non-discriminating assertions, high-variance/flaky evals, time/token tradeoffs); see `agents/analyzer.md`.
4. **Launch the viewer BEFORE you start forming your own opinion**, get examples in front of the human first:
   ```bash
   nohup python <skill-smith-path>/eval-viewer/generate_review.py \
     <workspace>/iteration-N --skill-name "my-skill" \
     --benchmark <workspace>/iteration-N/benchmark.json > /dev/null 2>&1 &
   VIEWER_PID=$!
   ```
   Iteration 2+: add `--previous-workspace <workspace>/iteration-<N-1>`. No-display environment: use `--static <output_path>` to emit a standalone HTML file. Use `generate_review.py`, don't hand-roll HTML.
5. Tell the user: two tabs, Outputs (click through, leave feedback) and Benchmark (the quantitative comparison).

### Step 3.5: Read feedback

When the user is done, read `feedback.json` (empty feedback = fine). Focus improvements where they had specific complaints. `kill $VIEWER_PID` when done.

## 4. Improve (REFACTOR)

The heart of the loop.

- **Generalize from the feedback:** you're iterating on a few examples to build a skill used a million times. Don't overfit with fiddly per-example MUSTs; if an issue is stubborn, try a different metaphor or working pattern. It's cheap to try.
- **Keep it lean:** read the transcripts, not just outputs. If the skill made the agent waste time, cut the part that caused it and re-test.
- **Explain the why:** terse/frustrated feedback still encodes a real need; transmit the understanding into the instruction, not a rigid rule.
- **Bundle repeated work:** if every baseline subagent independently wrote the same `create_docx.py`, that script belongs in `scripts/`. Write once, point the skill at it.

Then rerun all cases into `iteration-<N+1>/` (including baseline), relaunch the viewer with `--previous-workspace`, re-read feedback. Stop when the user is happy, feedback is all empty, or you've stopped making progress.

**Blind comparison (optional, rigorous):** to answer "is the new version actually better?", give two outputs to an independent agent without saying which is which and let it judge. See `agents/comparator.md` + `agents/analyzer.md`.

## 5. Optimize the description (empirical triggering)

The description decides whether the skill ever fires. After the skill is in good shape, optimize it against trigger evals instead of guessing.

1. **Generate ~20 trigger queries:** 8-10 should-trigger (varied phrasings, casual/formal, cases that don't name the skill), 8-10 should-NOT-trigger where the *near-misses* matter most (share keywords but need something else). Make them concrete and realistic: file paths, company names, typos, backstory. Avoid obvious negatives ("write a fibonacci function" tests nothing).
2. **Review with the user** via `assets/eval_review.html` (replace the `__*_PLACEHOLDER__` tokens, open it, let them edit/toggle/export to `~/Downloads/eval_set.json`).
3. **Run the loop in the background:**
   ```bash
   python -m scripts.run_loop --eval-set <trigger-eval.json> --skill-path <path-to-skill> \
     --model <model-id-of-this-session> --max-iterations 5 --verbose
   ```
   It splits 60% train / 40% held-out, runs each query 3x for a reliable trigger rate, proposes description rewrites with extended thinking, and picks `best_description` by **test** score (not train) to avoid overfitting. Tail it for updates.
4. **Apply** `best_description` to the frontmatter; show the user before/after + scores.

Note: simple one-step queries ("read this file") often won't trigger any skill regardless of description, because the model handles them directly. Trigger evals should be substantive enough that consulting a skill actually helps.

## 6. Package

If a `present_files`/packaging path is available: `python -m scripts.package_skill <path/to/skill-folder>`, then point the user at the resulting `.skill` file.

---

## Hardening discipline skills against rationalization

Discipline skills (rules the agent must hold under time pressure, sunk cost, exhaustion) need more than a clear statement, because smart agents find loopholes. Build these in:

- **Close every loophole explicitly.** Don't just say "delete the code." Say: "Delete it. Start over. Don't keep it as reference, don't 'adapt' it, don't look at it. Delete means delete."
- **Letter = spirit.** Add early: "Violating the letter of the rules is violating the spirit." Cuts off the whole "I'm following the spirit" class.
- **Rationalization table.** Capture every excuse the baseline agent made (verbatim) and answer it. `| "Too simple to test" | Simple code breaks. Test takes 30s. |`
- **Red-flags list.** Make self-checking easy: "If you catch yourself thinking 'I already manually tested it', STOP."
- **Encode violation symptoms in the description** so the skill triggers right when the agent is about to break the rule.

**Why these work** (authority, commitment, social proof, unity): see `references/persuasion-principles.md`. **How to write the pressure scenarios and plug holes systematically:** see `references/testing-skills-with-subagents.md`. **Anthropic's official authoring guidance:** `references/anthropic-best-practices.md`. **A full worked test campaign:** `examples/CLAUDE_MD_TESTING.md`.

## When to create a skill (and when not)

**Create when:** the technique wasn't obvious, you'd reuse it across projects, it applies broadly, others benefit. **Don't, when:** it's a one-off, a well-documented standard practice, a project-specific convention (-> CLAUDE.md), or a mechanical constraint enforceable by regex/validation (-> automate it; save skills for judgment calls).

## Reference files

- `references/schemas.md`: JSON for evals, grading, benchmark, metadata.
- `references/testing-skills-with-subagents.md`: pressure-scenario testing methodology.
- `references/persuasion-principles.md`: why anti-rationalization techniques work.
- `references/anthropic-best-practices.md`: official skill authoring patterns.
- `references/skill-design-principles.md`: design vocabulary: predictability, the two loads, information hierarchy, leading words, failure modes.
- `references/skill-design-glossary.md`: full definitions for the terms above.
- `agents/grader.md`, `agents/comparator.md`, `agents/analyzer.md`: subagent instructions.
- `examples/CLAUDE_MD_TESTING.md`: worked test campaign.

## STOP before the next skill

After writing any skill you MUST complete its test/verify cycle before moving on. Don't batch-create skills untested "for efficiency", because deploying an untested skill is deploying untested code. Each skill finishes RED-GREEN-REFACTOR before the next one starts.
