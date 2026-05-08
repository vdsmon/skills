# Stage: PUSH

> Push the current branch with the right upstream and refspec.

Prereqs: at least one commit ahead of the destination branch. A clean working tree (no uncommitted changes) is preferred but not required, the push only sends what is committed.

## Step 1.1: Sanity checks

```bash
BRANCH=$(git branch --show-current)
DEST=${SHIP_IT_TARGET:-$(python3 SKILL_DIR/scripts/load-config.py SKILL_DIR vcs.default_target 2>/dev/null || echo dev)}

# Must be on a real branch
[ -z "$BRANCH" ] && { echo "Detached HEAD, refusing to push"; exit 1; }

# Refuse to push the destination branch itself
[ "$BRANCH" = "$DEST" ] && { echo "On $DEST, create a feature branch first"; exit 1; }

# Must have at least one commit ahead of dest
git fetch origin "$DEST" --quiet
AHEAD=$(git log --oneline "origin/$DEST..HEAD" | wc -l | tr -d ' ')
[ "$AHEAD" = "0" ] && { echo "No commits ahead of origin/$DEST, nothing to push"; exit 1; }
```

If any check fails, stop and surface to the user. Do not auto-create a branch or auto-rebase.

## Step 1.2: Push with explicit refspec

```bash
git push -u origin "$BRANCH:$BRANCH"
git branch --set-upstream-to="origin/$BRANCH"
```

Why explicit `BRANCH:BRANCH`: if the local branch was created via `git switch -c X origin/dev`, the upstream is `origin/dev` and a bare `git push -u origin <branch>` will target `dev`. The explicit refspec forces the remote name to match the local name, regardless of upstream.

## Step 1.3: Push failures

| Failure | Diagnose |
|---|---|
| `Permission denied (publickey)` | SSH key issue. Tell user, do not auto-fix. |
| `! [remote rejected]` with branch protection message | Branch protected on remote. Stop. |
| `non-fast-forward` | Local is behind remote. Run `git fetch origin "$BRANCH"`, inspect `git log origin/$BRANCH..HEAD` and the reverse, ask user before any rebase or force action. |
| `repository not found` | Remote URL or auth wrong. Stop. |

Do NOT force-push to recover from any of these. A force-push is always a user-confirmed action.

## Step 1.4: Confirm

```bash
git log --oneline "origin/$DEST..origin/$BRANCH" | head -20
```

That output is the diff the PR will carry. Show it to the user briefly so they can spot a mis-targeted branch before the PR is opened.

## Next

Stage 2 (CREATE). Read `references/create.md`.
