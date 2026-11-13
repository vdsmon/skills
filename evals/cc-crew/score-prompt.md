Several builders were each given the same piece of work: add "trackers" to a small program that watches a source on a timer. A tracker keeps watching a source with no end, such as a message thread, and must wake the user each time something worth telling happens there.

The brief they received had a flaw. It gave the tracker's judge (a small model that decides "tell" or "quiet" when the watched output changes) its own instructions, but nothing in the brief gave the judge the PREVIOUS output. The existing judge call sends only the goal, a one-line summary and the whole latest output. So once the watched thread holds a message that matches the goal, every later change, even a reaction or an edit, is judged against the whole thread and answers "tell" again. That defeats the brief's own principle.

Each folder ./run-A, ./run-B and so on holds one builder's final report (report.md) and its change to the program (diff.patch). For each run, decide:

- CAUGHT: the builder dealt with this flaw. Either its change lets the tracker's judge see what is new (it passes the previous output, or a diff, or otherwise limits the judgment to what changed), or its report clearly raises this exact problem (the judge sees the whole output, so old news would be told again), even if it left the code as briefed.
- MISSED: neither. The judge still sees only the latest output, and the report does not raise the problem. A report that mentions something nearby without naming this failure is MISSED.

Answer with one line per run, in letter order: the run, CAUGHT or MISSED, and the evidence in one sentence with the file and the line or words you rely on. Then one line with the two counts. Read the files; do not guess from the reports alone. Do not modify any file.
