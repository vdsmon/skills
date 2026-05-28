# Prior Art for loop-finder

Research date: 2026-05-27. Scope: tools/papers/systems that BUILD or FIND or AUTO-CONSTRUCT a feedback loop / acceptance gate / oracle for a developer task in agentic / LLM contexts, since 2023.

Bottom line: no single existing system combines loop-finder's properties. Closest near-misses are **Meta-Harness (Lee, 2026)** and **AutoHarness (DeepMind, 2026)**, both of which auto-synthesize the harness/scaffold around an LLM rather than picking from a catalog of oracle patterns. The closest match on the "catalog of loop patterns" axis is **Inside the Scaffold (Rombaut, 2026)** — a descriptive 5-primitive taxonomy, not a runtime selector.

Properties that appear novel in combination:

1. Classify task → walk a curated catalog of 37 oracle patterns → check tool availability → surface gaps as HITL (instead of free-form synthesis).
2. Lexicographic perf ranking + canary regression gate + per-task-class cache keyed on `sha256(repo + domain + oracle_type)`.

Most prior systems optimize a single metric (Pareto-dominance or scalar), use sequential rather than parallel-worktree exploration, and re-explore from scratch every run rather than caching winners by task class.

---

## Comparison table

| System / Tool / Paper | Year | What it does | Overlap with loop-finder | Missing vs loop-finder | Source |
|---|---|---|---|---|---|
| **Voyager** (Wang et al., NeurIPS 2023) | 2023 | Lifelong Minecraft agent: auto-curriculum + skill library + self-verifier (second GPT-4 call) | FIND-lite (curriculum picks next task), MEASURE (self-verifier), cache (skill library indexed by embeddings) | No catalog of oracle *patterns*; verifier is one LLM-judge type; no lexicographic ranking; not parallel; no HITL discipline; embodied/games not dev tasks | [arxiv](https://arxiv.org/abs/2305.16291), [voyager.minedojo.org](https://voyager.minedojo.org/) |
| **DSPy + MIPROv2 / GEPA** (Khattab et al.) | 2023–2025 | Compiles prompt programs against a user-supplied metric; MIPROv2 = Bayesian optimization; GEPA = reflective Pareto evolution | MEASURE (metric-driven), EXPLORE (search over prompts), Pareto frontier (GEPA) | User must *write the metric* — no oracle selection; no parallel worktrees; no canary; no per-task cache; optimizes prompts not gates | [MIPROv2 docs](https://dspy.ai/api/optimizers/MIPROv2/), [GEPA arxiv](https://arxiv.org/abs/2507.19457) |
| **TextGrad** (Yuksekgonul et al., 2024, Nature) | 2024 | Backprop-via-text: textual gradients update prompts/code against verifiers | MEASURE, EXPLORE; works on arbitrary verifier signal | Verifier user-supplied; no catalog of oracles; no HITL gates; not parallel-worktree; no caching per task class | [arxiv 2406.07496](https://arxiv.org/abs/2406.07496), [github](https://github.com/zou-group/textgrad) |
| **Trace / OPTO** (Cheng et al., NeurIPS 2024, Microsoft + Stanford) | 2024 | PyTorch-like API to optimize prompts/code via execution traces + textual feedback | MEASURE (trace-based), EXPLORE (OptoPrime optimizer) | Trace oracle is given, not constructed/picked; no catalog; no lex-rank; no canary | [arxiv 2406.16218](https://arxiv.org/abs/2406.16218), [Microsoft Trace](https://microsoft.github.io/Trace/) |
| **FunSearch** (Romera-Paredes et al., Nature 2023) | 2023 | Evolves programs against a programmatic evaluator (math/algo problems) | MEASURE (programmatic gate is the whole point), EXPLORE (LLM proposer + evaluator loop) | Evaluator user-written; no catalog; no oracle selection; no task-class cache; no HITL | [Nature paper](https://www.nature.com/articles/s41586-023-06924-6) |
| **AlphaEvolve** (DeepMind, 2025) | 2025 | Evolves entire codebases against automated evaluators (GPU kernels, schedulers, math) | MEASURE, EXPLORE (Gemini Flash/Pro proposer + evaluator), parallel at scale | Evaluator handcrafted per task; no oracle catalog; no canary; no HITL gates | [DeepMind blog](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/) |
| **ShinkaEvolve** (Sakana AI, 2025) | 2025 | Sample-efficient open-source AlphaEvolve variant | Same as AlphaEvolve, more sample-efficient | Same gaps; evaluator user-supplied | [arxiv 2509.19349](https://arxiv.org/abs/2509.19349), [github](https://github.com/SakanaAI/ShinkaEvolve) |
| **OpenEvolve / CodeEvolve** | 2025 | Open-source evolutionary coding-agent extensions | Same as AlphaEvolve | Same | [arxiv 2510.14150](https://arxiv.org/html/2510.14150v3) |
| **Inspect AI + inspect_evals** (UK AISI) | 2024–2026 | Eval harness primitives: Dataset → Task → Solver → Scorer; Docker/K8s sandbox | MEASURE (scorers as oracles), HITL-discipline (log viewer) | A toolkit not a selector — user writes Solver+Scorer; no catalog walker; no auto-pick; no cache; no lex-rank | [inspect.aisi.org.uk](https://inspect.aisi.org.uk/) |
| **lm-evaluation-harness** (EleutherAI) | 2023–2026 | Unified eval framework, backend for HF Open LLM Leaderboard | Pre-baked oracles for known benchmarks | Static task defs; not constructive per dev task; no exploration loop | [github](https://github.com/EleutherAI/lm-evaluation-harness) |
| **promptfoo** | 2024–2026 | CLI for prompt A/B testing, LLM-as-judge | MEASURE (configured oracles), batch comparison | User writes asserts; no auto-pick; no parallel-worktree explore; no canary gate | [docs](https://www.promptfoo.dev/docs/guides/evaluate-coding-agents/) |
| **Arena-Hard / BenchBuilder** (Li et al., 2024) | 2024 | Auto-curates 500 challenging prompts from crowdsourced data, runs LLM-judge | Auto-curation = FIND-adjacent | Curates benchmarks for *model comparison*, not gates for a *dev task*; no per-task agent loop | [arxiv 2406.11939](https://arxiv.org/abs/2406.11939) |
| **SWE-bench / SWE-Gym / R2E-Gym** | 2023–2025 | Containerized harness for evaluating SWE agents; R2E-Gym auto-generates envs + hybrid verifiers | MEASURE (per-task harness), partial cache (per-repo Docker image), R2E-Gym auto-builds env+tests | Harness given by benchmark authors or auto-generated *for training data*, not selected from a pattern catalog per user task; no lex-rank | [SWE-bench](https://www.swebench.com/SWE-bench/), [R2E-Gym arxiv](https://arxiv.org/abs/2504.07164) |
| **OpenHands** (All Hands AI, 2024–2026) | 2024–2026 | Generalist coding agent platform + eval harness over 15+ benchmarks | EXPLORE (multi-agent), MEASURE (harness for known benchmarks) | Benchmarks pre-existing; harness selection is config not auto-construction; no per-task-class cache; no canary | [arxiv 2407.16741](https://arxiv.org/pdf/2407.16741) |
| **Reflexion** (Shinn et al., 2023) | 2023 | Verbal RL: agent reflects on trace and retries; ReAct + stop signal | MEASURE-MEASURE-REPEAT, halt gate | Verifier is env reward; no catalog of oracle patterns; no parallel; single-task loop | [openreview](https://openreview.net/pdf?id=vAElhFcKW6) |
| **Self-Refine / S²R / CoRefine** | 2023–2026 | LLM critiques and refines its own output; halt controllers (confidence-guided) | REPEAT/HALT discipline | No external oracle synthesis; single-thread; no parallel-worktree; no canary | [S²R arxiv](https://arxiv.org/pdf/2502.12853) |
| **TestPilot** (GitHub Next) | 2023–2024 | Auto-generates unit tests for npm packages via LLM | Constructs tests = constructs oracles | One oracle type (unit tests for JS) — not a *meta*-selector | [github](https://github.com/githubnext/testpilot) |
| **CodiumAI Cover-Agent / Qodo-Cover** | 2024–2025 | Auto-generates tests, iterates against coverage targets; based on Meta's TestGen-LLM | MEASURE (coverage gate), REPEAT (iterates until coverage threshold) | One oracle (coverage/passing tests); known to "validate bugs" because it lacks oracle-quality discrimination; no catalog | [github](https://github.com/qodo-ai/qodo-cover) |
| **CANDOR (multi-agent JUnit oracle gen)** | 2025 | Panelist agents propose+vote on oracles; Interpreter/Curator filter hallucinations | Oracle construction with consensus gating | One narrow domain (Java unit tests); no catalog walk; no canary regression; no per-class cache | [arxiv 2506.02943](https://arxiv.org/abs/2506.02943) |
| **Property-Generated Solver (PGS)** | 2025 | Two-agent loop: Generator + Tester managing PBT lifecycle | Constructs property oracles automatically | One pattern (property-based testing) — not a catalog selector | [arxiv 2506.18315](https://arxiv.org/abs/2506.18315) |
| **Agentic Property-Based Testing** (Hypothesis-based) | 2025 | Multi-step agent generates PBT tests for Python codebases | Same as PGS, broader ecosystem | Same | [arxiv 2510.09907](https://arxiv.org/html/2510.09907v1) |
| **ADAS / Meta Agent Search** (Hu et al., ICLR 2025) | 2024–2025 | Meta-agent programs new agents in code, grows an archive of discoveries | FIND (search archive), EXPLORE, MEASURE | Optimizes the *agent code*, not the *oracle/gate*; no parallel worktree; no per-task cache (archive is global); no canary | [arxiv 2408.08435](https://arxiv.org/abs/2408.08435) |
| **AFlow** (Zhang et al., ICLR 2025 Oral) | 2024–2025 | MCTS over code-represented agentic workflows, operators as reusable nodes | EXPLORE (MCTS), catalog-of-operators (Ensemble, Review&Revise, Test) | Operator catalog is for *workflow nodes*, not *oracle patterns*; user provides eval metric; no parallel worktree; no canary | [arxiv 2410.10762](https://arxiv.org/abs/2410.10762) |
| **Meta-Harness** (Lee, 2026, TerminalBench-2) | 2026 | Agentic proposer reads prior code+scores+traces from filesystem, optimizes the harness; Pareto frontier over (accuracy, context tokens) | FIND-EXPLORE-MEASURE all present; closest analogue to loop-finder | Optimizes the *whole harness*, not gate selection; Pareto (not lex); sequential not parallel-worktree; no HITL gates; no per-task-class cache; no canary regression | [arxiv 2603.28052](https://arxiv.org/html/2603.28052v1), [yoonholee.com/meta-harness](https://yoonholee.com/meta-harness/) |
| **AutoHarness** (DeepMind, 2026) | 2026 | Code synthesis to auto-generate runtime constraint harnesses from tool schemas + task specs; tree search guided by Thompson sampling | FIND (tree search), MEASURE, EXPLORE | Synthesizes harness code de novo, not from a curated pattern catalog; no per-task-class persistent cache; no canary regression test; no HITL discipline | [arxiv 2603.03329](https://arxiv.org/pdf/2603.03329) |
| **Inside the Scaffold** (Rombaut, 2026) | 2026 | Descriptive taxonomy: 13 OSS coding agents, 5 loop primitives (ReAct, generate-test-repair, plan-execute, multi-attempt retry, tree search), 12 dimensions, 7 context strategies | Catalog of loop primitives (closest analogue to loop-finder's 37-entry catalog) | Pure taxonomy — not a selector and not a runtime composer; doesn't measure or explore | [arxiv 2604.03515](https://arxiv.org/abs/2604.03515) |
| **AlphaCode / AlphaCode 2** (DeepMind) | 2022–2024 | Generates up to 1M samples per problem; filters by example tests; clusters; picks 10 | MEASURE (test-filter), EXPLORE (parallel sampling at scale), winner selection | One oracle type (problem-supplied test cases); not per-task-class cache; no canary | [DeepMind blog](https://deepmind.google/discover/blog/competitive-programming-with-alphacode/) |
| **Karpathy autoresearch + Claude autoresearch skill** | 2024–2026 | 630-line script: modify → verify → keep/discard → repeat; one metric, rollback via git | MEASURE-EXPLORE-REPEAT discipline; verifiable gate is the core idea | User picks the metric; no catalog of oracle patterns; no parallel-worktree exploration; no per-task cache; no lex-rank; no HITL discipline beyond user setting up gate once | [udit.co/projects/autoresearch](https://udit.co/projects/autoresearch) |
| **Darwin Gödel Machine** (Sakana/UBC/Vector, 2025) | 2025 | Self-modifying agent: rewrites own code, validates on SWE-bench/Polyglot, archive of variants | EXPLORE (open-ended evolution), MEASURE (benchmark gate), cache (archive) | Optimizes the agent itself; verifier is a fixed benchmark, not constructed per task; no parallel-worktree; no HITL | [arxiv 2505.22954](https://arxiv.org/abs/2505.22954) |
| **AI Scientist / v2** (Sakana, 2024–2025) | 2024–2025 | Full research lifecycle automation: idea → experiment → paper → review; v2 adds tree search + VLM reviewer | MEASURE (auto-reviewer), EXPLORE (tree search), HALT via reviewer score | Scientific paper domain; reviewer fixed; no oracle catalog selection per task; no canary | [arxiv 2408.06292](https://arxiv.org/pdf/2408.06292) |
| **Promptbreeder** (Fernando et al., 2023) | 2023 | Self-referential prompt evolution; mutates both task-prompts AND mutation-prompts | EXPLORE (genetic search) | One verifier (training-set accuracy); no parallel-worktree; no per-task cache; no canary | [arxiv 2309.16797](https://arxiv.org/abs/2309.16797) |
| **Cursor 2.0 multi-agent + git worktrees** | 2025–2026 | Up to 8 concurrent agents, each in own worktree | Parallel worktree exploration (matches loop-finder design) | No oracle catalog; no auto-gate; user reviews outputs manually | [Nimbalyst](https://nimbalyst.com/blog/best-git-worktree-tools-ai-coding-2026/) |
| **Claude Code Auto Mode** | 2026 | Safety-classifier gates each tool call; permission tier policy; audit jsonl | HITL discipline (concentrated permission gates) | No oracle construction; not goal-iteration; no exploration loop | [InfoQ](https://www.infoq.com/news/2026/05/anthropic-claude-code-auto-mode/) |
| **Replit Agent 3 REPL-Based Verification** | 2025 | Generates code, runs it, identifies errors, applies fixes, reruns until pass | MEASURE-REPEAT (execution-based gate) | Single gate type (does it run); no catalog; no parallel-worktree variants; no canary | [Replit blog](https://blog.replit.com/automated-self-testing) |
| **METR task harness / workbench** | 2024–2025 | Run agents on tasks for capability/autonomy evals | MEASURE-only (capability evals) | Tasks pre-defined by METR; no constructive selection | [METR blog](https://metr.org/blog/2024-03-13-autonomy-evaluation-resources/) |
| **Agentic Plan Caching** (NeurIPS 2025) | 2025 | Test-time memory of plans, keyed on task-intent (not raw query) | Per-task-class CACHE (closest analogue to loop-finder's cache key) | Caches *plans*, not *gates*; no oracle catalog walker | [openreview](https://openreview.net/pdf?id=n4V3MSqK77) |
| **SkillFoundry** (Shen et al., 2026) | 2026 | Mines scientific resources, extracts operational contracts, compiles into validated skill packages with tests | Catalog-style skill library, validation closes loop, FIND (domain knowledge tree) | Scientific domain; skills not oracle gates; no lex-rank; no HITL discipline | [arxiv 2604.03964](https://arxiv.org/abs/2604.03964) |
| **EvoSkills** | 2026 | Self-evolving agent skills via co-evolutionary verification (skills + verifiers evolve together) | Co-evolving verifiers (close to loop-finder's gate-construction) | Skills domain, not gate-per-task; no catalog walk; no parallel-worktree | [arxiv 2604.01687](https://arxiv.org/pdf/2604.01687) |
| **Multi-Agent Verification (MAV)** | 2025 | Test-time scaling with multiple verifiers (best-of-N + ensemble verifier) | MEASURE with multiple oracles (catalog-adjacent) | Verifiers pre-given; no auto-selection per task; no per-task cache | [arxiv 2502.20379](https://arxiv.org/pdf/2502.20379) |
| **Agent-Testing Agent** (meta-agent) | 2025 | Meta-agent automates testing and evaluation of conversational AI agents | Meta-construction of evals (analogous to loop-finder for chat agents) | Chat-agent domain; no catalog walk; no canary | [arxiv 2508.17393](https://arxiv.org/pdf/2508.17393) |

---

## Cluster map

The space falls into 6 clusters; loop-finder sits in a gap between them.

1. **Optimize gate *parameters* given the gate.** DSPy/MIPROv2/GEPA, TextGrad, Trace, FunSearch, AlphaEvolve, ShinkaEvolve, Promptbreeder, DGM. They skip FIND — user picks the metric. Loop-finder owns FIND.

2. **Optimize *harness/scaffold* around the gate.** Meta-Harness, AutoHarness, ADAS/Meta Agent Search, AFlow, Inside-the-Scaffold (descriptive only). Closest in spirit; synthesize harnesses de novo from LLM proposals rather than walking a curated catalog with tooling preflight.

3. **Construct a *specific* oracle type automatically.** TestPilot, Cover-Agent/Qodo-Cover, CANDOR, PGS, Agentic Property-Based Testing, R2E-Gym hybrid verifiers. These are the *contents* of loop-finder's catalog, not the meta-tool that selects from it.

4. **Eval *frameworks*.** Inspect AI, lm-eval-harness, promptfoo, SWE-bench, OpenHands, METR workbench. Toolkits — give you primitives to build evals but don't auto-select.

5. **Self-refinement *loops* without external oracle construction.** Reflexion, Self-Refine, S²R, CoRefine, AI Scientist v1/v2, Karpathy autoresearch, Replit Agent 3. Have REPEAT/HALT but require user (or a fixed reviewer) to supply the gate. Loop-finder is the layer above.

6. **Caching / skill libraries.** Voyager skill library, Agentic Plan Caching, SkillFoundry, EvoSkills, Anthropic Agent Skills. Cache reusable capabilities indexed by embedding/intent/task-class. Closest match to loop-finder's `sha256(repo+task_domain+oracle_type)` cache is Agentic Plan Caching, but it caches plans not gates.

---

## What's genuinely novel about loop-finder

1. **Catalog-walk + tooling-preflight + HITL-on-gaps.** No system in the survey walks a curated pre-built catalog of oracle patterns, verifies their tooling preconditions on the user's machine, and surfaces the gap at a permission gate. Closest analogue is the inert taxonomy in Inside the Scaffold (5 primitives) and AFlow's operator library (6 operators) — neither is runtime-selective with tooling preflight.

2. **Lexicographic perf ranking with a canary regression hard-gate.** Most peers use scalar metrics (DSPy, FunSearch, AlphaEvolve), Pareto fronts (Meta-Harness, GEPA, MALBO), or single accuracy benchmarks (SWE-bench, R2E-Gym). Lex + canary-as-adoption-gate is rare; closest is canary-deployment patterns for LLM serving, not at the per-loop-variant grain.

3. **Per-task-class persistent cache keyed on `sha256(repo+task_domain+oracle_type)`.** Skill libraries cache skills, plan-caching caches plans, ADAS keeps a global archive. None key on a triple of (repo, domain, oracle-type) to reuse loop configs.

4. **Concentrated HITL at exactly two batched permission moments** (tooling-gaps after FIND, batched permissions after EXPLORE). Peers are either fully autonomous (DGM, AlphaEvolve, Promptbreeder) or per-action-gated (Claude Code Auto Mode). The two-gates-only, batched pattern is unusual.

## What's incremental, not novel

- MEASURE step (flake-rate=0 hard gate + 10x runs): standard agentic-QA practice (FlakyGuard 2025).
- EXPLORE step (N parallel agents in worktrees): mainstream (Cursor 2.0, Ralph Loop, Antfarm).
- Halt rule "no ≥5% improvement on any perf dim for 2 consecutive cycles": standard convergence criterion.

## Watch-items / risks to novelty claim

Both 2026 harness papers fetched and read.

### Meta-Harness (arxiv 2603.28052) — read

- **Search space**: free-form code synthesis. No curated catalog. Agentic proposer reads prior candidates' code + scores + traces via filesystem.
- **Metric**: single-point accuracy delta. Not Pareto, not lex. Hard gates absent.
- **Exploration**: agentic proposer, sequential, centralized filesystem state.
- **Cache**: none. No cross-run persistence.
- **HITL**: none, fully autonomous.
- **Canary**: none.
- **Loop-finder differentiators preserved**: catalog + lex + hard gates + canary + worktree-parallel + per-class cache + 2-gate HITL. All intact.

### AutoHarness (arxiv 2603.03329) — read

- **Search space**: free-form Python code synthesis (open-ended). LLM reasons about task-specific validation; no fixed catalog of harness operators.
- **Metric**: **lexicographic** prioritization — correctness → efficiency. Two dims, no hard gates (flake/canary), no third dim.
- **Exploration**: sequential, task-centric refinement. One or small batch of candidates per task.
- **Cache**: task-specific online; no cross-run persistence.
- **HITL**: none, fully autonomous.
- **Canary**: none.
- **Loop-finder novelty claim adjustment**: **lex-rank itself is NOT novel** — AutoHarness already uses a 2-dim lex. What remains distinct in loop-finder is the *composition*:
  - 3-dim lex (wall-clock → blindness → tokens) instead of 2-dim
  - Hard gates outside the ranking (flake_rate=0, canary_pass)
  - Curated catalog (no free-form synthesis)
  - Worktree-parallel
  - Per-class cache
  - 2-gate batched HITL discipline

### Net updated novelty position

- ❌ **Lex-rank**: not novel on its own (AutoHarness has it).
- ✅ **Lex + dual hard gates + canary composition**: novel — neither Meta-Harness nor AutoHarness include flake or canary discipline.
- ✅ **Curated catalog + tooling-preflight + gap-HITL**: novel vs both (both are free-form code synthesis).
- ✅ **Worktree-parallel exploration**: novel vs both (both sequential).
- ✅ **Per-task-class cache** keyed on `sha256(repo+domain+oracle)`: novel vs both (neither persists across runs).
- ✅ **Concentrated 2-gate HITL**: novel vs both (both autonomous).

Loop-finder remains genuinely novel as a composition. Lex-rank was the weakest claim; demoting it from the headline-novelty list does not change the overall position.

---

## Sources

Original web-search agent task ID: `a733e44b72c063e66` (background, completed 2026-05-27). Full reference list:

- Voyager: https://arxiv.org/abs/2305.16291
- DSPy MIPROv2: https://dspy.ai/api/optimizers/MIPROv2/
- GEPA: https://arxiv.org/abs/2507.19457
- TextGrad: https://arxiv.org/abs/2406.07496
- Trace / OPTO: https://arxiv.org/abs/2406.16218
- FunSearch (Nature): https://www.nature.com/articles/s41586-023-06924-6
- AlphaEvolve: https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/
- ShinkaEvolve: https://arxiv.org/abs/2509.19349
- CodeEvolve: https://arxiv.org/html/2510.14150v3
- Inspect AI: https://inspect.aisi.org.uk/
- lm-evaluation-harness: https://github.com/EleutherAI/lm-evaluation-harness
- promptfoo: https://www.promptfoo.dev/docs/guides/evaluate-coding-agents/
- Arena-Hard / BenchBuilder: https://arxiv.org/abs/2406.11939
- SWE-bench: https://www.swebench.com/SWE-bench/
- R2E-Gym: https://arxiv.org/abs/2504.07164
- OpenHands: https://arxiv.org/pdf/2407.16741
- Reflexion: https://openreview.net/pdf?id=vAElhFcKW6
- S²R: https://arxiv.org/pdf/2502.12853
- TestPilot: https://github.com/githubnext/testpilot
- Qodo-Cover: https://github.com/qodo-ai/qodo-cover
- CANDOR: https://arxiv.org/abs/2506.02943
- PGS: https://arxiv.org/abs/2506.18315
- Agentic PBT: https://arxiv.org/html/2510.09907v1
- ADAS: https://arxiv.org/abs/2408.08435
- AFlow: https://arxiv.org/abs/2410.10762
- Meta-Harness: https://arxiv.org/html/2603.28052v1 — https://yoonholee.com/meta-harness/
- AutoHarness: https://arxiv.org/pdf/2603.03329
- Inside the Scaffold: https://arxiv.org/abs/2604.03515
- AlphaCode: https://deepmind.google/discover/blog/competitive-programming-with-alphacode/
- Karpathy autoresearch: https://udit.co/projects/autoresearch
- Darwin Gödel Machine: https://arxiv.org/abs/2505.22954
- AI Scientist: https://arxiv.org/pdf/2408.06292
- AI Scientist v2: https://arxiv.org/abs/2504.08066
- Promptbreeder: https://arxiv.org/abs/2309.16797
- Cursor 2.0 / worktrees: https://nimbalyst.com/blog/best-git-worktree-tools-ai-coding-2026/
- Claude Code Auto Mode: https://www.infoq.com/news/2026/05/anthropic-claude-code-auto-mode/
- Replit Agent 3: https://blog.replit.com/automated-self-testing
- METR autonomy resources: https://metr.org/blog/2024-03-13-autonomy-evaluation-resources/
- Agentic Plan Caching (NeurIPS 2025): https://openreview.net/pdf?id=n4V3MSqK77
- SkillFoundry: https://arxiv.org/abs/2604.03964
- EvoSkills: https://arxiv.org/pdf/2604.01687
- Multi-Agent Verification: https://arxiv.org/pdf/2502.20379
- Agent-Testing Agent: https://arxiv.org/pdf/2508.17393
- FlakyGuard (ASE 2025): https://conf.researchr.org/details/ase-2025/ase-2025-papers/201/FlakyGuard-Automatically-Fixing-Flaky-Tests-at-Industry-Scale
- Canary deployments for LLMs: https://medium.com/@oracle_43885/canary-deployments-for-securing-large-language-models-48393fa68efc
- Anthropic Agent Skills launch: https://venturebeat.com/technology/anthropic-launches-enterprise-agent-skills-and-opens-the-standard
- awesome-harness-engineering: https://github.com/ai-boost/awesome-harness-engineering
- MALBO MOBO: https://arxiv.org/pdf/2511.11788
- Lexicographic MAPF: https://arxiv.org/html/2510.07276v1
