---
name: plan
description: Turns a design settled with the user into one plan file, a page to align on and briefs cut from the file. Use when a design has been settled in a grilling and work is about to be handed to builders.
---

# plan

A design was settled with the user. Make it buildable, and align with him on the whole without making him read again what he already decided.

## 1. Write the plan file

Write `~/.claude/plans/<name>/plan.md` in the shape of [plan-template.md](plan-template.md). The file is for you to follow and for the record: do not paste it into the session, and do not use plan mode.

- **Principle.** The one sentence he approved. Test it against every case you discussed: a sentence broader than you mean gets built faithfully.
- **Decisions.** Each with who decided it and why. A decision without a reason cannot be applied to a new case; if he gave none, ask once.
- **Work.** Each item is its builder's brief: what it is for first, what the builder owns, where, the work in order, each limit with its reason, what done means, what it runs beside. An item stands on its own: it may name another item, but never sends the reader there for instructions.
- **Every brief.** What every builder on this plan needs beyond the builder's own text: shared limits, who else is working where.
- **What approval starts.** Everything his approval sets in motion that is his to decide: paid runs, edits outside the repository, merges, anything outward.
- **Sign-off.** Yours. A plan you present carries your signature: you stand behind it, and it is ready for his. A plan you are not yet behind is a draft, unsigned, with what you do not agree with. You may withdraw your signature before work starts, and you say why.

Name things by what they are. Number only what will be referred to, and write short words out ("Work 2").

## 2. Have it reviewed

Send the plan and its principle to the reviewer: start `cc-crew:reviewer` with `review.sh plan`. Weigh what comes back before fixing anything: is the failure real, and is the guard worth it? A pass with no blocker ends the review. A second fix to the same spot means the design is in question. A third pass that still finds a blocker goes to the user.

## 3. Build the page

The page is where you and the user align. It is free in form: design it for this plan, restrained, colour welcome. Lead with what he has not seen yet.

1. The principle.
2. One picture of the whole: who does and judges what, or what changes.
3. What is new since you talked: what the review changed, what you decided without asking.
4. The work in order: who builds each item, what runs together.
5. What approval starts, and what it does not cover.
6. Your sign-off, as a signature beside the place for his. A draft shows yours empty.
7. The settled decisions, folded away as the record.

Publish it privately, say which version of the plan it shows, and give him the link with two or three lines on what approval starts. His "approved" covers what the page showed him: anything that is his to decide and is not on it is not approved.

## 4. On "approved"

1. Record in the plan file which page version he approved, and anything agreed after it. On the page, add his signature and an approved stamp; each signature carries its date and time.
2. Cut the briefs: `python3 "${CLAUDE_SKILL_DIR}/scripts/cut_briefs.py" <plan.md> <out-dir>`.
3. Send each brief to a `cc-crew:builder` exactly as cut. Items marked to run together each get their own worktree.

## 5. While it is built

- Every change to the plan file republishes the page.
- Show each item's state on the page (briefed, built, reviewed, pushed) and refresh it at each handback and at the push.
- A comment on the page that shows something is unclear: change the page, post nothing beyond the automatic reply, and resolve the thread.
- Before the push, the combined diff goes to the reviewer with `review.sh diff`.
