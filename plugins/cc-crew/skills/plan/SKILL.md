---
name: plan
description: Turns a design settled with the user into one plan file, a page to align on and briefs cut from the file. Use when a design has been settled in a grilling and work is about to be handed to builders.
---

# plan

A design was settled with the user. Make it buildable, and align with him on the whole without making him read again what he already decided.

## 1. Write the plan file

The plan file is `~/.claude/plans/<name>/plan.md`, in the shape of [plan-template.md](plan-template.md). It is for you to follow and for the record: do not paste it into the session, and do not use plan mode.

A grilling that kept a record already wrote this file: its principle, approved at the close, its example, its terms and its decisions. Keep them as they are, and do not reword the principle. Its Open section must be empty: a question still open goes back to a grilling round, not into the plan. Add the sections below that the file lacks. After a small grilling, which keeps no record, or with no grilling at all, write the whole file:

- **First lines.** Under the title the file says where the plan stands, and you change them only through `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/plans.py"`, at the moment something changes. `plans.py hold <plan.md>` names the repository and this session as the plan's holder; a grilling's record is held already. The plan's folder name is its name everywhere, also this session's, so it is kebab-case of at most 40 characters. `Page:` is the page's link, written by hand.

- **Principle.** The one sentence he approved. Test it against every case you discussed: a sentence broader than you mean gets built faithfully.
- **Terms.** Every word the plan uses that he did not bring himself: where it comes from (the code, a teammate, a document, you), what it means in plain words, and his yes to it. The file keeps them through a compaction.
- **Decisions.** Each with who decided it and why. A decision without a reason cannot be applied to a new case; if he gave none, ask once.
- **The ladder.** The shortest runs that tell whether the work does what it is for, cheapest first, each a rung. Every plan answers it; `None, because <reason>.` is an answer. Each rung says, in labelled sub-items, what it runs, what it mocks or skips, what it cannot tell, and its time and cost, measured or "not measured yet", never estimated; the page script refuses a rung that lacks one. Its cases start from the grilling's example and its hard cases, so the lowest rung runs what you already discussed. A lowest rung that does not exist yet is built first, as Work item 1, unless it costs more than the real runs it saves; then the section says so. A paid rung goes under what approval starts, as Victor's to start. A rung passed is not the plan done: `Done means: Rung <n>.` says which one is.
- **Work.** Each item is its builder's brief: what it is for first, what the builder owns, where, the work in order, each limit with its reason, what done means (the rung its builder must pass, when the plan has rungs), the items it waits on (`After:`), what it runs beside. An item stands on its own: it may name another item, but never sends the reader there for instructions. The last work item is shipping, yours, written for this plan: the combined diff to the reviewer, the push, the pull request, the merge, and what the repository needs after it.
- **Every brief.** What every builder on this plan needs beyond the builder's own text: shared limits, who else is working where.
- **What approval starts.** Everything his approval sets in motion that is his to decide: paid runs, edits outside the repository, merges, anything outward.
- **Sign-off.** Yours. A plan you present carries your signature: you stand behind it, and it is ready for his. A plan you are not yet behind is a draft, unsigned, with what you do not agree with. You may withdraw your signature before work starts, and you say why.

Name things by what they are. Number only what will be referred to, and write short words out ("Work item 2").

## 2. Have it reviewed

Send the plan to the reviewer: run, in the background, `"${CLAUDE_PLUGIN_ROOT}/scripts/review.sh" plan <plan.md>`. It reads the principle from the file and puts its answers in `reviews/` beside it; the last line it prints is the answer file. Exit 3 means Codex is out of usage: the last line is then the folder the script prepared, and that folder goes to `cc-crew:reviewer-fallback`. Weigh what comes back before fixing anything: is the failure real, and is the guard worth it? A pass with no blocker ends the review. A second fix to the same spot is a stop: the design is in question, so change the design or drop the fix. A third pass that still finds a blocker goes to the user.

## 3. Build the page

The page is where you and the user align. It is one skeleton, so he finds the same things in the same places in every plan; the look is the plan's own.

1. Make the plan's own pieces in `page/` beside the plan file: `look.css`, the plan's values for the tokens the skeleton lists (its colours for both themes, its typefaces, loaded by an `@import` from Google Fonts on the first line, and its small touches), nothing about layout, and a look that differs from every other plan under way, because he tells his plans apart by it; `picture.html`, the whole in one picture (who does and judges what, or what changes); `new.html`, what is new since you talked (what the review changed, what you decided without asking, every word that still needs his yes), or one sentence saying nothing is; and `own.html` only when the plan has parts of its own, each under its own heading. Use no word that is not his or in Terms.
2. Sign, unless it is a draft: add the Signed line to the sign-off. Run `plans.py phase <plan.md> "awaiting approval"`.
3. Run `python3 "${CLAUDE_SKILL_DIR}/scripts/page.py" <plan.md>`. It fills everything else from the plan file and writes `page.html` beside it; exit 1 names every missing piece. Never edit `page.html`: change the plan file or a piece and run it again.
4. Publish `page.html` privately, write its link into the file's `Page:` line, run the script and publish again, and give him the link with two or three lines on what approval starts.

On top the page shows the plan's name, where it stands, the principle and the version shown. Its blocks: "The whole, in one picture", "New since we talked", "The work", "The ladder", the plan's own parts, "What your approval starts", "Sign-off", "The words", "The record". In the phases grilling and awaiting approval they come in that order, all open but "The record", which stays folded because he settled those decisions himself; in building and done, "The work", "New since we talked" and "The ladder" lead, open, and the rest follow folded. A dropped plan takes the second order when he had approved it.

The script serves a plan with `page/` beside its file. A plan whose page was written by hand before the script keeps that page to its end: never run the script on it, and wherever a step says to run the script and publish, bring that page up to date by hand.

Experiments that run side by side are work items marked `Runs with:`, which the page's work part shows, or they do not run. His "approved" covers what the page showed him: anything that is his to decide and is not on it is not approved.

## 4. On "approved"

1. Record his approval in the sign-off's Approved line, which holds his words and nothing else, and in a paragraph below the two lines which published version of the page he approved and anything agreed after it.
2. `plans.py phase <plan.md> building`, then `plans.py progress <plan.md>`, which writes one line per work item into the file's Progress section. Run the page script and publish.
3. Cut the briefs: `python3 "${CLAUDE_SKILL_DIR}/scripts/cut_briefs.py" <plan.md> <out-dir>`.
4. Start a `cc-crew:builder` for each brief and give it the brief's path, not its text or a summary of it: a file cannot be paraphrased. Items marked to run together each get their own worktree.

## 5. While it is built

- Where a work item stands is written in the plan file: `plans.py item <plan.md> <n> <not started|under way|done> [note]` when it starts, at every handback and at the push. The note of a handback names its report and its commits; what the builder suggested, and what you did with it, goes under `## What the builders suggested`.
- Whenever the plan cannot move, say who or what it waits on: `plans.py wait <plan.md> "<who or what>: <what for, in a few words>"` (Victor's approval or answer, another plan's merge), and `plans.py go <plan.md>` when it moves again.
- Every change to the plan file is followed by the page script and a publish to the same link; the script draws the work's states from the phase and the Progress section. A hand-written page is kept, as section 3 says.
- A comment on the page that shows something is unclear: change the plan file or the piece, republish, post nothing beyond the automatic reply, and resolve the thread.
- Before the push, the combined diff goes to the reviewer: `review.sh diff <plan.md> <repo> <base> <head>`. A question about an answer goes through `review.sh follow-up <folder> <question-file>`.
- Where Victor merges, the wait for his merge is part of shipping: `plans.py wait <plan.md> "Victor: the merge of #<n>"`, arm a watch on the pull request, and only then end your turn. A watch also wakes you when it is stuck or its check fails, so look at the pull request first: merged, `plans.py go <plan.md>` and finish what is left of shipping; not merged, leave the wait as it is and arm the watch again.

## 6. The closing step

When the last work item is done, finish the plan, unasked. A plan is done when its own work is: a notice to the team or to other people, or a question about another piece, does not hold it open. An act of Victor's that the plan's own work needs does: the merge, a run only he may start.

1. Record the decisions, and what the builders suggested, where the project keeps them.
2. Remove the plan's worktrees and branches.
3. `plans.py close <plan.md> done "<how it ended, and what is left for Victor>"`. It refuses while a work item is not done or the plan still waits on something, and it asks for one line on each point of this list: give them in your reply.
4. Bring the page to its final state: run the script and publish.
5. Give him the stamp, from the counts it prints: `🚢 Shipped: <n> work items · <n> reads · pull request <n>`.

A plan Victor drops is closed the same way, with `close <plan.md> dropped`. Its unmerged branches and worktrees stay until he says to delete them, and until he answers the plan waits on him.
