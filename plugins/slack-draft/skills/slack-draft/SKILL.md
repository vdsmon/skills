---
name: slack-draft
description: >-
  Drafts a Slack message for the user to send, in Slack mrkdwn, ready to
  copy-paste. Leads with the conclusion, backticks technical identifiers,
  mirrors the thread's language (Brazilian Portuguese in casual work
  register, or natural English), and strips AI-writing tells. Output is the
  drafted message only; the skill never posts to Slack.
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

## Workflow

1. **Mirror the thread's language and register.** If the thread is in Portuguese, write Brazilian Portuguese; if English, write English. Match how the people in the thread actually talk (casual vs formal). When there is no thread, default to the user's own language for that audience.
2. **Lead with the conclusion.** First line says the finding, decision, or ask. Evidence and context come after, not before. A colleague skimming on their phone should get the point from line one.
3. **Keep it tight.** Cut throat-clearing ("Just wanted to flag that...", "After some investigation..."). Cut sentences that restate context everyone in the thread already has. If a sentence does not carry new information or an action, drop it.
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

In Slack, raw identifiers get lost in prose and sometimes auto-linkified. Wrap them in inline backticks: table/column names (`Company.externalId`), field names (`owner_id`, `owner_external_id`), record/registro codes (`D200`, `D990`), config keys, file paths, CLI flags, and literal values being discussed (`0001`, `BR13`). Plain numbers that are just quantities (load ids, counts) can stay bare; values that are being matched/compared read better backticked.

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

## Portuguese register (when writing PT-BR for work chat)

The default Acme work register is casual, not formal corporate:

- `tá` over `está`, contractions over full forms, where it reads natural.
- Keep the anglicisms the team uses: `mapping`, `match`, `deploy`, `load`, `clean`, `core`, `form`. Do not translate these into stiff Portuguese (`mapeamento`, `limpo`).
- Prepositions follow the loanword's gender as the team says it (`no DSL`, `no banco de core`).
- Still correct grammar and accents; casual is not sloppy.

Confirm the register if the audience is unknown (a message to leadership or a client reads more formal than one to a squad channel).

## Message shapes

Pick the shape that fits; adapt freely. Each is one finding/ask, lead-first.

**Investigation finding** (root cause, evidence, action):
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
