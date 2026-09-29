# Inconsistency pass (casual mode only)

Read this only when casual mode is on. Rule numbers (#11, #18, #26, #27) point to the patterns in SKILL.md.

Everything in SKILL.md removes a tell. This pass adds something instead, so it runs only when `--casual` is set.

Real writers are not sloppy, they're inconsistent. They pick differently on the same question in paragraph 2 and paragraph 9, because the local sentence pulled them a different way. An LLM picks once and holds it for the whole document, and that unbroken consistency is itself a signature.

**The test: two valid forms means inconsistency, and that reads human. One valid form means error, and that reads sloppy.** Never cross into the second. Typos are not on this list and never will be, they're the one edit a reader can spot and blame.

Ten axes:

1. **Contractions track emphasis.** `don't` normally, `do not` when you actually mean it. Driven by the sentence, not by a coin flip.
2. **Oxford comma optional.** Keep it where it prevents ambiguity, drop it where it doesn't. Humans hold no policy here.
3. **Bullet terminal periods mixed.** Full-sentence bullets get one, fragments don't, and the boundary is fuzzy. LLMs go all-or-nothing.
4. **Uneven bullet shape.** One bullet three words, the next three lines. Mix a verb-led bullet with a noun-led one. LLMs match length and part of speech across every item in a list.
5. **Backtick fatigue.** Backtick an identifier on first use, then write it plain. LLMs backtick every occurrence forever.
6. **Second-reference shortening.** `the authentication service` -> `auth service` -> `auth`. Direction is the test: shorter is human, a sideways synonym is #11 and stays banned.
7. **Number-style drift.** `3 million lines` in one sentence, `two or three times` in the next. LLMs apply "spell out under ten" with no exceptions.
8. **Sentence-initial `And` / `But` / `So`.** LLMs avoid these. Humans start sentences this way constantly.
9. **Lowercase after a colon,** even when the clause is independent. LLMs capitalize by rule.
10. **Dropped optional `that`, dropped intro comma.** `the thing I built` over `the thing that I built`, `In 2023 we shipped` over `In 2023, we shipped`. Not every time, which is the entire point.

Guard, still binding in casual mode:

- **Never vary anything with one canonical form.** API names, CLI flags, file paths, env vars, error strings, function names, anything inside a code fence. #27 already requires the system's actual name and casual mode does not relax it.
- **Never introduce an error.** Misspellings, `its`/`it's`, `their`/`there`, subject-verb disagreement, broken Markdown. Those are wrong, not loose. If only one form is valid there is nothing to vary.
- **No alternating on a schedule.** `ABABAB` is just a different machine pattern. Each variation needs a local reason.
- **Accents stay fully correct** (#18). Casual is about register, never about the language itself.
- **Skip it entirely** in commit messages, error text, API docs, legal or compliance text, and migration steps.
- **Ceiling: a handful per page.** If the reader can count them, there are too many.

#26 stays always-on and is not part of this pass: dropping hyphens removes a tell, while these axes add variance. The Soul section already covers emotional variance, so don't duplicate it here.

Output: name the axes you applied in the one short confirmation line, since skipping the pass is otherwise invisible. A bare chat reply stays the rewrite alone.
