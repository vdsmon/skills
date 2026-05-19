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
3. Add voice, don't just strip tells. Soulless is not human.
4. Final pass: ask yourself *"what still sounds AI?"* then fix the residue.

## Soul

Clean writing without voice is still obviously AI. Signs of soulless-but-clean output:

- Every sentence same length and structure
- Neutral reporting, no opinions
- No mixed feelings, no uncertainty
- No first person where it fits
- Reads like Wikipedia or a press release

Ways to add voice:

- **Opinions.** React to facts, don't just report them. When the source asserts a judgment call as fact (`The cleanest path is X`), reframe as opinion (`I think the cleanest path is X`). Forces honest framing, reads more human.
- **Rhythm.** Mix short punches with longer sentences. Humans chain related ideas with commas, conjunctions, and prepositions far more than AI does. Long flowing sentences are a tell of human prose, not a fault to fix. Default to chaining, reach for a period only when the next idea is genuinely independent.
- **Complexity.** Humans have mixed feelings. Let them in.
- **"I".** First person is honest, not unprofessional.
- **Mess.** Tangents, asides, half-formed thoughts = human.
- **Specifics.** Not *"this is concerning"*, name what's concerning.
- **Restraint.** Don't strip articles in pursuit of brevity (`new service is deployed` -> `the new service is deployed`). The output should read like a careful human, not a telegraph operator. Match the register of the source: a neutral source stays neutral. Don't add metaphors (`fanned out into thousands of writes`, `waste a day chasing version mismatches`) the source didn't ask for. Vivid is good when the topic is vivid, forced vivid is just a different AI tell.

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

**6. Formulaic "Challenges" sections.** Watch: *Despite its... faces several challenges, Despite these challenges, Challenges and Legacy, Future Outlook.* Boilerplate balance paragraph. Cut, or replace with specifics.

### Language

**7. AI vocabulary words.** *Additionally, align with, crucial, delve, emphasizing, enduring, enhance, fostering, garner, highlight (v), interplay, intricate, key (adj), landscape (abstract), pivotal, showcase, tapestry, testament, underscore (v), valuable, vibrant.* These spike post-2023 and co-occur often.

**8. Copula avoidance.** Watch: *serves as, stands as, marks, represents, boasts, features, offers.* LLMs substitute elaborate verbs for *is / are*. Use *is / are / has* directly.

**9. Negative parallelisms.** *"Not only... but..."*, *"It's not just X, it's Y"*. Cut.

**10. Rule of three.** Forcing ideas into triplets (*innovation, inspiration, insights*). Drop to two, or flatten.

**11. Synonym cycling.** Same subject rephrased each sentence (*protagonist -> main character -> central figure -> hero*). Pick one noun, stick with it.

**12. False ranges.** *"From X to Y"* where X and Y aren't on a scale. List plainly.

### Style

**13. Em dashes and double-dashes, zero tolerance.** Both `—` (Unicode) and ` -- ` (ASCII). `grep` the file before editing, these are the highest-signal AI tell and the easiest to miss by eye. Scope: all prose including code-comment prose in docs (ADRs, READMEs, etc.). Skip only in real source files (`.py`, `.ts`, etc.).

Replace each em-dash with a connector that matches how the clauses actually relate, in this rough priority:

1. **Comma + conjunction** (`and`, `but`, `while`, `because`, `so`, `though`): usually the right fix. Em-dashes most often join two thoughts that flow into each other, and a comma + connector preserves the flow.
2. **Preposition** (`with`, `after`, `before`, `despite`, `like`, `into`): when the second clause modifies the first.
3. **Colon**: when the second clause is a list, definition, or direct elaboration of the first. Especially good when a leading code fence or noun is the subject and the rest of the line elaborates it: `make test: needs Docker, takes 30 seconds.`
4. **Parentheses**: when the second clause is a real aside.
5. **Period**: only when the clauses are independent ideas. Last resort, not first. Replacing every em-dash with a period creates staccato fragment chains, also an AI tell (see #25).

**Do NOT use semicolons.** Also an AI tell.

Glossary format: `**Term** — def` becomes `**Term:** def`.

Before:
> We built three layers of comparison -- not test fixtures, not mocks. Tests run offline -- no database, no SSO, no network.

After (period-heavy, still reads AI):
> We built three layers of comparison. Not test fixtures, not mocks. Tests run offline: no database, no SSO, no network.

After (chained, reads human):
> We built three layers of comparison, and they aren't test fixtures or mocks. Tests run offline, so no database, no auth, no network.

**14. Mechanical boldface.** Emphasizing phrases in bold by default. Cut unless the emphasis earns it.

**15. Inline-header vertical lists.** `- **Header:** sentence.` repeated. Collapse to prose, or plain bullets.

**16. Title Case Headings.** AI capitalizes every main word. Use sentence case.

**17. Decorative emojis.** 🚀 💡 ✅ on headings and bullets. Strip.

**18. Stay on the ASCII keyboard.** Restrict to characters you can type on a US keyboard: straight quotes (`"…"`), straight apostrophe (`'`), ASCII arrow (`->`), tight slashes (`A/B`), regular hyphen (`-`), regular star (`*`), the letter `x` for multiplication. NEVER use Unicode flourishes: curly quotes (`"…"`), curly apostrophe (`'`), Unicode arrow (`→`), em-dash (`—`), en-dash (`–`), multiplier sign (`×`), bullet character (`•`), ellipsis character (`…`), or any other typographic Unicode character. LLMs default to the typographically "correct" Unicode form, especially in tech-adjacent contexts. Humans default to ASCII for grep-ability, terminal compatibility, and copy-paste safety. The em-dash rule (#13) is the highest-signal version of this same axis. Rule #18 generalizes it to every Unicode typography character.

Quick grep before submitting: `grep -nP '[—–×•…→"'"'"''""'"'"']' <file>` should print nothing. (Spaced slashes like `A / B` won't be caught by that grep, scan visually for those.)

### Communication

**19. Chatbot artifacts.** *"I hope this helps", "Of course!", "Certainly!", "You're absolutely right!", "Would you like...", "Let me know", "Here is a..."*: chat scaffolding pasted as content. Delete.

**20. Knowledge-cutoff disclaimers.** *"as of my last update", "While specific details are limited", "based on available information".* Cut. Commit to what you actually know, or drop the claim.

**21. Sycophancy.** *"Great question!", "You're absolutely right", "Excellent point".* Delete, just make the point.

### Filler

**22. Filler phrases.**
- *In order to* -> *to*
- *Due to the fact that* -> *because*
- *At this point in time* -> *now*
- *In the event that* -> *if*
- *Has the ability to* -> *can*
- *It is important to note that ...* -> (delete the framing, keep the noun)

**23. Excessive hedging.** *"It could potentially possibly be argued that the policy might have some effect"* -> *"The policy may affect outcomes."*

**24. Generic positive conclusions.** *"The future looks bright", "Exciting times lie ahead", "A journey toward excellence".* Cut, or replace with a concrete plan.

**25. Staccato fragment chains.** Three or more fragments in a row for drama (*"The server crashed. No warning. No logs. Just silence."*). One punchy fragment is human, a pattern of them is AI. Merge with commas, conjunctions (`and`, `but`, `while`, `because`, `so`), or prepositions (`with`, `after`, `before`, `despite`). That's how humans chain related thoughts.

Before:
> Push went out. CI passed. The reviewers were notified. The lint check came back green.

After:
> Push went out, CI passed on the first try, and the lint check came back green once the reviewers were notified.

Common merge patterns: `X. Y.` becomes `X, and Y.` or `X while Y.` or `X because Y.` or `X, with Y.`

**26. Hyphenated-pair overuse.** *third-party, cross-functional, client-facing, data-driven, decision-making, well-known, high-quality, real-time, long-term, end-to-end.* AI hyphenates these with perfect consistency. Humans drop the hyphens inconsistently. Drop them for common pairs.

**27. Jargon and corporate idioms.** Watch: *leverage, synergy, ecosystem, holistic, paradigm, robust, scalable, mission-critical, best-in-class, low-hanging fruit, move the needle, deep dive, circle back, going forward, value-add, deliverable, actionable, operationalize, level up, north star, single source of truth, at scale, in the weeds, on the same page.* These read smooth in a US boardroom and slow down anyone who learned English as a second language.

Latinate-over-Anglo-Saxon is the same tell in vocabulary form: *utilize, implement, commence, terminate, facilitate, demonstrate, acquire, ascertain, endeavor, sufficient, additional, approximately.* Pick the shorter, plainer word.

Dev-specific jargon is the same problem with a different audience: *shim, gate, bake in, swallow (errors), bubble up, wire up, fan out, plumb through, plumbing, blast radius, footgun, monkey-patch, kick off, hook into, surface (verb).* These are vivid and exact to engineers, opaque to anyone else. If the audience includes non-engineers (PR readers from product, finance, ops, legal), prefer the plain word: *shim* -> *wrapper*, *gate* -> *check*, *swallow* -> *ignore* or *hide*, *bubble up* -> *show* or *pass up*, *wire up* -> *connect*, *fan out* -> *split*, *kick off* -> *start*.

US-cultural idioms are the sharpest version of this and get a hard stop, not a soft preference. They are invisible to a US reader and opaque to everyone else, and most prose is read by more non-Americans than Americans. Three families:

- Sports (mostly baseball and American football): *ballpark, ballpark figure, home run, hit it out of the park, touch base, curveball, Hail Mary, full-court press, move the goalposts, slam dunk, drop the ball, step up to the plate, inside baseball, Monday-morning quarterback, punt (on something), end run, off base, cover all the bases, rain check, the ball is in your court.*
- Military and combat: *air cover, beachhead, boots on the ground, in the trenches, war room, rally the troops, scorched earth, take point, in the line of fire, battle-tested, bite the bullet, dodged a bullet, double down, fall on your sword, top brass, bandwidth (figurative).*
- Business-casual Americana: *move the needle, boil the ocean, sacred cow, dog and pony show, drink the Kool-Aid, ducks in a row, herding cats, bang for the buck, table stakes, skin in the game, run it up the flagpole, open the kimono, eat our own dog food, secret sauce, the whole nine yards, par for the course, ground floor, blue-sky, moonshot, 80/20, low-hanging fruit, take it offline.*

Swap for the literal meaning: *air cover* -> *public backing*. *ballpark* -> *rough estimate*. *touch base* -> *check in*. *table stakes* -> *the minimum to compete*. *skin in the game* -> *something to lose*. *boil the ocean* -> *do too much at once*. *move the needle* -> *make a real difference*. *ducks in a row* -> *organized*. *par for the course* -> *what you would expect*. *bite the bullet* -> *accept the pain*. *the ball is in your court* -> *it is your decision*. Test: if the literal words do not give a non-American the meaning, replace it.

Common swaps: *leverage* -> *use*. *robust* -> *handles errors*. *paradigm* -> *approach*. *deep dive* -> *look closely*. *circle back* -> *come back to it*. *deliverable* -> *what we ship*. *low-hanging fruit* -> *easy wins*. *move the needle* -> *make a real difference*. *at scale* -> *under load*. *utilize* -> *use*. *implement* -> *build, do*. *facilitate* -> *help*. *demonstrate* -> *show*. *commence* -> *start*. *terminate* -> *stop*. *acquire* -> *get*. *ascertain* -> *find out*. *additional* -> *more*. *sufficient* -> *enough*.

Use the system's actual verb when describing an action the system performs. If a UI button says "Mark as ready", write "marking as ready" rather than "going non-draft" (which isn't a verb anywhere). If an API method is named `update_user_email`, write "called `update_user_email`" rather than "submitted the change". Coining new phrasing where a canonical one exists is an AI tell: the model fills in the most plausible-sounding verb when the precise one was right there. Same for CLI subcommands, queue/topic names, status enums, button labels.

Audience reminder: most prose you produce will be read by non-native English speakers, often a majority. The word a teenager would use is the right default. If the plain word makes the sentence shorter, even better. US-cultural idioms (sports, military, business-casual Americana) are a hard stop, treated like the em-dash rule, not a stylistic nicety. When in doubt about a phrase, say the literal thing.

## Process

1. Read the input.
2. `grep` for `—` and ` -- `. Fix every hit first, highest-signal tell, easiest to miss by eye.
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
