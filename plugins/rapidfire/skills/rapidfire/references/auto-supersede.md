# Auto-supersede

New idea overlaps with a `status: dispatched` ticket's `## Files` AND user intent contradicts the in-flight design:

1. Detect during Step 2 refine.
2. `TaskStop(task_id=<old ticket's agent_id>)`.
3. Update old ticket: `status: killed`, `superseded_by: T<new>`, `finished_at: <now>`.
4. Write new ticket: `supersedes: T<old>`, `origin: supersede`. Dispatch (bypasses budget).
