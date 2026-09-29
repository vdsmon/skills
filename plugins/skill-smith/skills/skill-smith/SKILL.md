---
name: skill-smith
argument-hint: "[skill name or what to build]"
disable-model-invocation: true
description: Build, test, and improve Agent Skills with a baseline-first eval loop and a skill-design vocabulary.
---

# Skill Smith

Writing a skill is TDD for process documentation, run with real measurement:

| TDD phase | Skill work |
|-----------|------------|
| **RED:** watch the test fail | Run the task **without** the skill (baseline). Capture what the agent does and its exact rationalizations. |
| **GREEN:** minimal code to pass | Write the minimal skill that fixes *those* failures. Run **with** the skill. The agent now complies. |
| **REFACTOR:** clean up, stay green | The agent finds a new loophole: add a counter, re-test until it holds. |

**The Iron Law:** a behavior change to a discipline or workflow skill ships only after you watched the baseline fail without it, because otherwise you do not know it prevents the right failure. Wording-only edits, and an explicit "skip the evals" from the user, are exempt.

Join where the user is: "I want a skill for X" starts at Step 1, "here's a draft" at Step 3, "is the new version better?" is Step 3 with an `old_skill` baseline, and "it never triggers" is the description rule in Step 2. Track the steps in your task list so the viewer and feedback steps are not dropped.

## 1. Capture intent

If the conversation already holds the workflow ("turn this into a skill"), mine it first: tools used, step order, the user's corrections, input and output formats. Then confirm the gaps: what the skill lets the agent do, when it should fire, the output format, edge cases, and success criteria. Objectively checkable outputs (file transforms, extraction, codegen, fixed workflows) get test cases; subjective ones (style, design) get a qualitative review. Suggest one and let the user decide.

Make it a skill when the technique is not obvious and you would reuse it across projects. A one-off, a well-documented standard practice, or a project convention belongs in CLAUDE.md; a mechanical constraint belongs in a check or a regex.

## 2. Write the draft

**The description.** Third person, 280 chars or fewer. Say *when* to load the skill, not how it works: a description that summarizes the process tempts the agent to follow the summary and skip the body. Name each distinct trigger branch once, because Codex and other hosts read only this field. In Claude Code, put extra trigger phrasings in `when_to_use` (it shares a 1,536-char cap with the description). A user-only skill (`disable-model-invocation: true`) gets a one-line description for humans and no `when_to_use`. How to prune it: "Context pointers" in `references/skill-design-principles.md`.

**Skill type** decides how Step 3 tests it: *technique* (a method with steps), *pattern* (a way of thinking), *reference* (API or command docs), or *discipline* (a rule the agent must hold under pressure; harden it, see the last section).

**Writing.** Second-person imperative. State the target behavior and the reason for it: a reason generalizes where a bare MUST does not. One runnable, commented example beats five thin ones. Write a reusable reference, not a story of one session.

For the design vocabulary (the two loads, the information hierarchy, completion criteria, leading words, pruning, and the failure modes to diagnose in Step 4), read `references/skill-design-principles.md`. Anthropic's authoring guide: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices

## 3. Test and evaluate

Run this as one sequence. Put results in `<skill-name>-workspace/` beside the skill, as `iteration-<N>/eval-<ID>/`.

### 3.1 Spawn with-skill and baseline runs in the same turn

For each test case, launch two subagents at once. **Every eval subagent runs on Sonnet: pass `model: "sonnet"` to the Agent tool for with-skill, baseline, and grader runs, always.** The skill has to work for the cheaper model most sessions run, and a stronger model masks the failures the baseline exists to surface. On a host where you cannot pick the subagent model, run with-skill and baseline as separate sessions on the cheaper model.

**With-skill:**
```
Execute this task:
- Skill path: <path-to-skill>
- Task: <eval prompt>
- Input files: <eval files, or "none">
- Save outputs to: <workspace>/iteration-<N>/eval-<ID>/with_skill/run-1/outputs/
- Outputs to save: <what the user cares about>
- Also save transcript.md in that folder: each step you took, in order, and the final result
```

**Baseline** (your RED), same template and prompt:
- **New skill:** no skill at all; save to `without_skill/run-1/outputs/`.
- **Improving a skill:** snapshot it first (`cp -r <skill-path> <workspace>/skill-snapshot/`), point the baseline at the snapshot, save to `old_skill/run-1/outputs/`.

The `run-<K>` level is required: the aggregator finds `grading.json` and `timing.json` only inside `<config>/run-<K>/`, and reports 0% when they sit one level up. Repeat runs are `run-2`, `run-3`. Write `eval-<ID>/eval_metadata.json` per case: `eval_id`, a descriptive `eval_name`, `prompt`, `assertions: []`.

### 3.2 While the runs are in flight

Draft assertions: objectively checkable, with names that read clearly in the viewer (subjective skills get a qualitative review instead). Save them to `evals/evals.json` and the per-eval metadata; schemas are in `references/schemas.md`.

As each run completes, write the `total_tokens` and `duration_ms` from its completion notification to `timing.json` in the run dir. The notification is the only place they exist.

### 3.3 Grade, aggregate, view, read feedback

1. **Grade:** spawn a grader on Sonnet with `agents/grader.md`, passing the assertions, the run's `outputs/transcript.md`, and its outputs dir; or grade inline. `grading.json` uses the fields `text`, `passed`, `evidence`, which the viewer reads by name. Script any check a program can do.
2. **Aggregate:** `python3 <skill-smith-path>/scripts/aggregate_benchmark.py <workspace>/iteration-N --skill-name <name>` writes `benchmark.json` and `benchmark.md`: pass rate, time, and tokens as mean ± stddev, and the delta, new minus baseline.
3. **Analyst pass:** find what the aggregate hides: assertions that pass in both configs (not discriminating) or fail in both (broken or out of reach), assertions that pass only without the skill (the skill hurts), high-variance evals, outlier runs, and the time and token cost against the pass-rate gain. Add each finding as one data-grounded sentence to the `notes` array in `benchmark.json`, where the viewer shows it. Save fixes for Step 4.
4. **Launch the viewer before you form your own opinion**, so the human sees examples first. Start it with the Bash tool's `run_in_background`, since shell state does not persist between calls:
   ```bash
   python3 <skill-smith-path>/eval-viewer/generate_review.py <workspace>/iteration-N \
     --skill-name "<name>" --benchmark <workspace>/iteration-N/benchmark.json
   ```
   Iteration 2+: add `--previous-workspace <workspace>/iteration-<N-1>`. With no display, add `--static <file>.html` for a standalone page; its feedback downloads as `feedback.json`.
5. Tell the user: two tabs, Outputs (click through, leave feedback) and Benchmark (the numbers).
6. When the user is done, read `feedback.json` (empty feedback means fine) and focus on their specific complaints. Stop the viewer with `lsof -ti :3117 | xargs kill`.

## 4. Improve (REFACTOR)

- **Generalize from the feedback.** You iterate on a few examples to build a skill used many times. Fix the cause, not the example: when an issue is stubborn, try a different metaphor or working pattern instead of a per-example MUST.
- **Keep it lean.** Read the transcripts, not only the outputs. When the skill made the agent waste time, cut the part that caused it.
- **Explain the why.** Terse feedback still encodes a real need; put that understanding into the instruction.
- **Bundle repeated work.** If every run wrote the same helper script, ship it in `scripts/` and point the skill at it.

Rerun every case into `iteration-<N+1>/`, baseline included, relaunch the viewer with `--previous-workspace`, and read the feedback again. Stop when the user is happy, the feedback is empty, or progress stalls.

For a blind A/B judgment between two versions, or to tune a model-invoked skill's trigger accuracy, hand off to Anthropic's skill-creator (`anthropic-skills:skill-creator` in Claude Code).

## Hardening discipline skills

Everywhere else, lead with the target behavior and its reason. A discipline skill must also hold under time pressure, sunk cost, and exhaustion, and smart agents find loopholes. For each loophole the baseline found, add a bright-line rule paired with the positive action (the prohibition names the loophole and never stands alone), a row in a rationalization table (the verbatim excuse and its answer), and a red-flag thought that means stop. Say early that breaking the letter of the rule breaks its spirit. For a model-invoked discipline skill, name the violation symptoms in the description so it fires just before the break. Read `references/testing-skills-with-subagents.md` for pressure scenarios, the fix formats, and which persuasion fits which skill type.

Finish one skill's RED-GREEN-REFACTOR before you start the next.
