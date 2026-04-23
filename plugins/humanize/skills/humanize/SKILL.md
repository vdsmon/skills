---
name: humanize
description: >-
  Rewrites text to strip AI-writing tells and inject human voice. Detects
  em-dash overuse, AI vocabulary, inflated significance, rule-of-three,
  negative parallelisms, sycophancy, and 20+ more patterns catalogued in
  Wikipedia's Signs of AI writing. Output is a final rewrite plus a short
  residual-tells list.
when_to_use: >-
  Use when the user says "humanize this", "remove AI tells", "edit for
  voice", "sounds too AI", "make this more human", or pastes text for a
  humanization pass. Also triggers when editing or reviewing prose in
  Markdown or plain text files where AI-ness is the target to strip.
paths: "*.md, *.mdx, *.txt, *.rst"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

# humanize

Rewrite text to sound human. Identify AI tells, fix them, inject voice.

## Task

1. Scan text for the patterns below.
2. Rewrite problem sections. Preserve meaning and intended tone.
3. Add voice — don't just strip tells. Soulless ≠ human.
4. Final pass: ask yourself *"what still sounds AI?"* then fix the residue.

## Soul

Clean writing without voice is still obviously AI. Signs of soulless-but-clean output:

- Every sentence same length and structure
- Neutral reporting, no opinions
- No mixed feelings, no uncertainty
- No first person where it fits
- Reads like Wikipedia or a press release

Ways to add voice:

- **Opinions.** React to facts, don't just report them.
- **Rhythm.** Mix short punches with longer sentences.
- **Complexity.** Humans have mixed feelings. Let them in.
- **"I".** First person is honest, not unprofessional.
- **Mess.** Tangents, asides, half-formed thoughts = human.
- **Specifics.** Not *"this is concerning"* — name what's concerning.

Before (clean, no pulse):
> The experiment produced interesting results. Agents generated 3 million lines of code. Some developers were impressed while others were skeptical. Implications remain unclear.

After (has a pulse):
> 3 million lines of code, generated while the humans slept. Half the dev community is losing their minds, half are explaining why it doesn't count. The truth is probably boring and in the middle. But I keep thinking about those agents working through the night.

## Patterns

### Content

**1. Inflated significance.** Watch: *stands/serves as, testament, pivotal, vital, crucial, underscores, reflects broader, marks a shift, turning point, landscape, indelible mark, deeply rooted.* AI puffs arbitrary details as "marking" or "contributing to" a broader topic. Strip the puffery, state the fact.

**2. Notability inflation.** Watch: *independent coverage, cited in major outlets, active social media presence.* Drops source lists instead of concrete claims. Replace with one specific quote or fact.

**3. Superficial -ing analyses.** Watch: *highlighting, underscoring, emphasizing, ensuring, reflecting, contributing to, cultivating, fostering, encompassing, showcasing.* Present participles tacked on for fake depth. Cut, or split into separate sentences of actual information.

**4. Promotional tone.** Watch: *boasts, vibrant, rich (figurative), profound, nestled, in the heart of, groundbreaking, renowned, breathtaking, must-visit, stunning.* Tourism-brochure voice. Replace with neutral description.

**5. Weasel attributions.** Watch: *Industry reports, Observers have cited, Experts argue, Some critics, several sources.* Vague authorities. Replace with a named source and date.

**6. Formulaic "Challenges" sections.** Watch: *Despite its… faces several challenges, Despite these challenges, Challenges and Legacy, Future Outlook.* Boilerplate balance paragraph. Cut, or replace with specifics.

### Language

**7. AI vocabulary words.** *Additionally, align with, crucial, delve, emphasizing, enduring, enhance, fostering, garner, highlight (v), interplay, intricate, key (adj), landscape (abstract), pivotal, showcase, tapestry, testament, underscore (v), valuable, vibrant.* These spike post-2023 and co-occur often.

**8. Copula avoidance.** Watch: *serves as, stands as, marks, represents, boasts, features, offers.* LLMs substitute elaborate verbs for *is / are*. Use *is / are / has* directly.

**9. Negative parallelisms.** *"Not only… but…"*, *"It's not just X, it's Y"*. Cut.

**10. Rule of three.** Forcing ideas into triplets (*innovation, inspiration, insights*). Drop to two, or flatten.

**11. Synonym cycling.** Same subject rephrased each sentence (*protagonist → main character → central figure → hero*). Pick one noun, stick with it.

**12. False ranges.** *"From X to Y"* where X and Y aren't on a scale. List plainly.

### Style

**13. Em dashes and double-dashes — zero tolerance.** Both `—` (Unicode) and ` -- ` (ASCII). `grep` the file before editing — these are the highest-signal AI tell and the easiest to miss by eye. Replace with periods, commas, colons, or parentheses per the relationship between clauses. **Do NOT use semicolons** — also an AI tell. Scope: all prose including code-comment prose in docs (ADRs, READMEs, etc.). Skip only in real source files (`.py`, `.ts`, etc.).

Glossary format: `**Term** — def` becomes `**Term:** def`.

Before:
> We built three layers of comparison -- not test fixtures, not mocks. Tests run offline -- no database, no SSO, no network.

After:
> We built three layers of comparison. Not test fixtures, not mocks. Tests run offline: no database, no SSO, no network.

**14. Mechanical boldface.** Emphasizing phrases in bold by default. Cut unless the emphasis earns it.

**15. Inline-header vertical lists.** `- **Header:** sentence.` repeated. Collapse to prose, or plain bullets.

**16. Title Case Headings.** AI capitalizes every main word. Use sentence case.

**17. Decorative emojis.** 🚀 💡 ✅ on headings and bullets. Strip.

**18. Curly quotes.** `"…"` instead of `"…"`. Replace with straight quotes.

### Communication

**19. Chatbot artifacts.** *"I hope this helps", "Of course!", "Certainly!", "You're absolutely right!", "Would you like…", "Let me know", "Here is a…"* — chat scaffolding pasted as content. Delete.

**20. Knowledge-cutoff disclaimers.** *"as of my last update", "While specific details are limited", "based on available information".* Cut. Commit to what you actually know, or drop the claim.

**21. Sycophancy.** *"Great question!", "You're absolutely right", "Excellent point".* Delete, just make the point.

### Filler

**22. Filler phrases.**
- *In order to* → *to*
- *Due to the fact that* → *because*
- *At this point in time* → *now*
- *In the event that* → *if*
- *Has the ability to* → *can*
- *It is important to note that …* → (delete the framing, keep the noun)

**23. Excessive hedging.** *"It could potentially possibly be argued that the policy might have some effect"* → *"The policy may affect outcomes."*

**24. Generic positive conclusions.** *"The future looks bright", "Exciting times lie ahead", "A journey toward excellence".* Cut, or replace with a concrete plan.

**25. Staccato fragment chains.** Three or more fragments in a row for drama (*"The server crashed. No warning. No logs. Just silence."*). One punchy fragment is human. A pattern of them is AI. Merge.

**26. Hyphenated-pair overuse.** *third-party, cross-functional, client-facing, data-driven, decision-making, well-known, high-quality, real-time, long-term, end-to-end.* AI hyphenates these with perfect consistency. Humans drop the hyphens inconsistently. Drop them for common pairs.

## Process

1. Read the input.
2. `grep` for `—` and ` -- `. Fix every hit first — highest-signal tell, easiest to miss by eye.
3. Scan for the 26 patterns above.
4. Rewrite sections. Check the revision:
   - Sounds natural read aloud
   - Varies sentence structure naturally
   - Prefers specific over vague
   - Uses *is / are / has* where appropriate
5. Produce a draft.
6. Ask yourself: *"What still sounds AI?"* List the residue as bullets.
7. Revise against that list.
8. Output final.

## Output

1. Draft rewrite
2. Residual-tells bullets
3. Final rewrite
4. (Optional) short changelog of removed patterns

## Source

Pattern taxonomy adapted from [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (WikiProject AI Cleanup). Core idea: LLMs pick the most statistically likely next token across the widest range of cases. That's the signature you're erasing.
