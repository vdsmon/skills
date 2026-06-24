---
name: slack-draft
argument-hint: "[what to say or thread context] [--tech|--plain]"
disable-model-invocation: true
description: >-
  Drafts a Slack message for the user to send, in Slack mrkdwn, ready to
  copy-paste. Leads with the conclusion, backticks technical identifiers,
  defaults to English and switches to Brazilian Portuguese or Spanish only
  when the user explicitly asks, and strips AI-writing tells. Defaults to a
  plain, high-level register for a non-technical reader; pass --tech for a
  peer who reads code. Output is the drafted message only; the skill never
  posts to Slack.
when_to_use: >-
  Use when the user wants to send something on Slack and asks you to write
  it: "draft a Slack message", "write a reply for this thread", "what should
  I post", "reply to Nicolas", "responde no Slack", "escreve uma mensagem
  pro time", "manda no canal". Also when the user shares a Slack thread/link
  and asks you to answer it, or asks you to translate or restyle a message
  they intend to post. Triggers even when "Slack" is not named but the target
  is clearly a chat message to a colleague or channel.
---

# slack-draft

Draft a Slack message the user can paste and send as-is. The bar is "they copy it, hit enter, and it reads like they wrote it." You produce text only. You never post.

## Hard rule: draft only, never post

Do not call any Slack tool. Do not post, schedule, or create a draft in Slack. Even if a Slack MCP is connected and the channel is obvious, your job ends at handing the user the text. Posting is theirs. If they later say "post it," that is a separate, explicit instruction outside this skill.

## Audience and depth (decide this first, from the args)

Two modes. They set how much the message explains and what vocabulary it uses. **Default is plain.** Most readers already know the situation and do not need the internals, just the high-level issue and what you need from them.

- **Plain / high-level (default, or `--plain`, "non-technical", "for the client", "for leadership").** The reader is not in the code. Give the high-level issue and the input or decision you need, nothing else. No schema identifiers, file paths, table/column names, no internals or option mechanics. Use plain nouns ("the buyer's tax category", not `filing_company.regime`). Still backtick the domain value or category you are discussing (`Monotributista`, `Responsable Inscripto`) per the backtick section: plain mode drops the code, not the specific terms. A short paragraph plus the ask is usually the whole message; collapse a multi-option writeup to the one recommendation and the input it needs.
- **Technical (`--tech` / `-t`, "technical", or when the args name a dev channel/peer and the point IS the mechanics).** The reader can read code. Keep the relevant identifiers, file paths, and option mechanics, backticked. Still terse (see step 3).

An explicit flag wins. Otherwise infer from the args ("for the client/leadership/ops" -> plain; "technical writeup", "for the dev channel", "keep the details" -> technical) and fall back to plain when neither a flag nor a clear cue is present.

## Workflow

1. **Default to English.** Write English unless the user explicitly asks for another language ("in Portuguese", "responde em português", "en español"). A thread or audience that is itself in Portuguese or Spanish does NOT switch the language on its own; the user has to ask. Once a language is set, match how the people in the thread actually talk (casual vs formal) and mirror their register.
2. **Lead with the conclusion.** First line says the finding, decision, or ask. Evidence and context come after, not before. A colleague skimming on their phone should get the point from line one.
3. **Keep it tight. The reader already lives this situation.** Do NOT brief them on the problem or recap how it came up; open on the finding, decision, or ask. Delete any sentence that is background the reader could have written themselves. Cut throat-clearing ("Just wanted to flag that...", "After some investigation..."). If a sentence does not carry new information or an action, drop it. When in doubt, shorter: a message that is one line too terse is fixed with a follow-up; one that over-explains wastes the reader on first read.
4. **Deliver in a fenced code block** so the user can copy the whole thing in one click. The content inside is Slack mrkdwn (it renders when pasted). Put nothing the user must hand-edit; if a value is genuinely unknown, mark it `<like-this>` and say so outside the block.
5. **Iterate on corrections fast.** Wording feedback is cheap and expected. Apply the exact change, keep the rest, re-emit the full block. Carry their corrections forward (a word swap they made once is a preference, not a one-off).

## Slack mrkdwn (not GitHub Markdown)

Slack formatting differs from Markdown. Use:

- `*bold*` (single asterisk), `_italic_`, `~strike~`, `` `inline code` ``
- ```` ``` ```` fenced blocks for multi-line code/logs
- `- ` or `* ` for bullets; `> ` for quotes
- Links as `<https://url|label>`

Do NOT use `**double asterisk**` bold or `# heading` lines. They render literally in Slack.

Caveat: if the message itself must contain a fenced code block, the outer copy-fence collides with it. In that case present the message without the outer fence (or note the collision) so the inner block survives.

## Backtick every technical identifier

In Slack, raw identifiers get lost in prose and sometimes auto-linkified. Wrap them in inline backticks: table/column names (`Company.externalId`), field names (`owner_id`, `owner_external_id`), record/registro codes (`D200`, `D990`), config keys, file paths, CLI flags, and literal values being discussed (`0001`, `BR13`). This includes the specific domain value or category the message is about, not only code-shaped identifiers: a tax category (`Monotributista`, `Responsable Inscripto`), a status (`blocked`, `in_review`), an enum value. Backticking sets the exact term apart from the prose, so it reads as "this specific value" rather than a passing word, and it applies even in plain mode, which drops the schema identifiers (`filing_company.regime`) but still backticks the category it is discussing. Plain numbers that are just quantities (load ids, counts) can stay bare; values that are being matched/compared read better backticked.

## Use structure for clarity (sparingly)

Reach for formatting when it makes the message scan faster, not as decoration. The test: does a phone reader grok it quicker WITH the structure than without?

- Bullets for 2+ parallel items (options, steps, findings, asks). Three things read faster as a list than as a comma-spliced sentence; one or two items stay inline.
- Bold and italics emphasize a *word or two mid-sentence*, the pivotal value or the one caveat, and only rarely. NOT as a label or header (`*What I need:*`), not on a whole sentence, not once per line. If everything is bold, nothing is. Most messages use neither.
- Fenced blocks for anything literal and multi-line: logs, a command to run, a short list of ids, a stack trace (mind the outer copy-fence collision noted above).
- Backticks for every identifier (see the section above), and lean ON them: a bare column or field name in prose reads like a typo, so prefer `Company.externalId` over spelling it out.

Do NOT over-format. A one or two sentence message needs none of this, and a wall of bold + bullets is as hard to read as a wall of prose. Structure earns its place only when the message has distinct parts; when in doubt, plain sentences win.

## Typography: ASCII punctuation, keep language accents

- No em-dashes or en-dashes. Use commas, periods, or parentheses.
- No curly quotes, Unicode arrows, multiplier signs, ellipsis char, or Unicode bullet chars. Use ASCII (`->`, `...`, `-`).
- Tighten spaced slashes: `A/B`, not `A / B`.
- **Accents are NOT typography.** Keep correct accents in Portuguese and Spanish (`produção`, `código`, `divergência`). Stripping them is wrong unless the user asks (e.g. encoding worries). For Spanish, use closing `?`/`!` only, no opening `¿`/`¡`.

## No manual line wrapping

Write each paragraph as one line and let Slack wrap it. Break lines only where it is semantic: between paragraphs, list items, or code lines. Do not insert newlines mid-sentence for an imagined width.

## Strip AI-writing tells

These artifacts go to a human who knows the user's voice, so they must not read as machine-written:

- No `**Term:** explanation` bullet lists. Write plain sentences.
- No title-case section headings inside a chat message.
- No rule-of-three padding ("fast, safe, and scalable"), no "not X, but Y" contrastive scaffolding, no "it's worth noting", "leverage", "seamless", "comprehensive".
- Full natural sentences with articles. This is an artifact for the user, not your own chat reply, so caveman/telegraph compression does not apply here.
- Use the system's own verb for system actions (a Bitbucket button "marks as ready"; an API "creates").

## Portuguese register (only when the user asked for PT-BR)

This section applies only after the user explicitly requested Portuguese (see step 1); English is the default. When PT-BR is requested, the Acme work register is casual, not formal corporate:

- `tá` over `está`, contractions over full forms, where it reads natural.
- Keep the anglicisms the team uses: `mapping`, `match`, `deploy`, `load`, `clean`, `core`, `form`. Do not translate these into stiff Portuguese (`mapeamento`, `limpo`).
- Prepositions follow the loanword's gender as the team says it (`no DSL`, `no banco de core`).
- Still correct grammar and accents; casual is not sloppy.

Confirm the register if the audience is unknown (a message to leadership or a client reads more formal than one to a squad channel).

## Message shapes

Pick the shape that fits; adapt freely. Each is one finding/ask, lead-first.

**Plain / high-level ask** (default mode: the issue at altitude + the one input needed, no internals):
```
The `Monotributista` column on the Rappi 2083 comes out empty: we have no source for each buyer's tax category, and the invoices only mark them class A. So every Monotributista buyer gets miscounted as `Responsable Inscripto`.

To fix it I need a short list from Rappi of which counterpart CUITs are Monotributistas, then the split works. The only alternative is an ARCA padron lookup, a much bigger lift with nothing built for it today. Can you get that list, or point me to who owns the relationship?
```

**Investigation finding** (technical mode: root cause, evidence, action):
```
Achei. O `Bloco D` da BR13 sai vazio em produção por uma divergência no cadastro, não no código.

A diferença tá na resolução do owner: as notas vêm com `owner_external_id` = `0001` e o `owner_id` em branco, então o mapping casa esse valor com `Company.externalId`. Em dev bate (`externalId` `0001`), em prod não (`externalId` `BR13`), e o owner sai nulo em todas as notas.

Evidências (04-2026):
- load dev 912403: `owner_id` = 9993657, form com `D200`
- load prod 14184: `owner_id` vazio, só `D001` + `D990`

Temos que setar `externalId` = `0001` na `Company` 5534880 no core de prod e reprocessar.
```

**Heads-up / status** (short, no evidence dump):
```
Subi o fix do `owner_id` da BR13 pra review: PR #2731. Roda local com `Bloco D` populado agora. Quando der, dá uma olhada.
```

**Ask / unblock** (what you need, why, by when if it matters):
```
Preciso de uma mão: o reprocesso da BR13 04-2026 depende de mudar `Company.externalId` no core de prod, e eu não tenho write lá. Consegue rodar, ou me passa o acesso? Tá segurando o fechamento do mês.
```

## Quick checklist before handing it over

- Conclusion in line one?
- Slack mrkdwn (`*bold*`, not `**bold**`)?
- Identifiers backticked?
- ASCII punctuation, accents intact?
- One line per paragraph, copy-fenced?
- Language and register match the thread?
- You did not post anything?
