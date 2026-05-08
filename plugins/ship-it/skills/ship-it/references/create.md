# Stage: CREATE

> Detect existing PR or open a draft. Humanize the body. Attach default reviewers.

Prereqs: branch pushed (Stage 1). Config loaded (`vcs.workspace`, `vcs.repo_slug`, `reviewers.user_account_id`).

## Step 2.1: Detect existing PR

A PR may already exist from a prior run, an auto-create on push, or a manual `bkt pr create`. Always check before creating:

```bash
BRANCH=$(git branch --show-current)
PR_ID=$(bkt pr list --mine --json 2>/dev/null \
  | jq -r --arg b "$BRANCH" '.values // [] | map(select(.source.branch.name==$b)) | .[0].id // empty')
```

- `PR_ID` empty -> Step 2.4 (create new).
- `PR_ID` set -> Step 2.5 (update existing).

### bkt CLI quirks

- `bkt pr list --source <BRANCH>` errors with `unknown flag: --source`. Use the `--mine --json` form above.
- `bkt pr list` returns `pull_requests: null` when the user has zero PRs. Piping null into `jq` raises `cannot iterate over null`. The `// []` fallback in the jq expression above prevents that.
- `bkt pr update` does not exist. The right subcommand is `bkt pr edit <id>`.
- `bkt pr create` has no `--draft` flag. Step 2.4 routes creation through `bkt api` to set `draft:true`.
- `bkt api -d @file` does not work, it returns `invalid character '@' looking for beginning of value`. Use `-d "$(cat file)"`.

## Step 2.2: Build the body

The body comes from one of two paths:

1. **`--body <path>` flag**: copy the file contents to `.ship-it-body.tmp.md`. The file is the source of truth.
2. **No `--body`**: draft the body from git. Minimum template:

```bash
cat > .ship-it-body.tmp.md <<EOF
## Summary

<one-paragraph what changed and why, written by you from git log + diff stat>

## Commits

$(git log --reverse --oneline "origin/$DEST..HEAD")

## Diff stat

\`\`\`
$(git diff --stat "origin/$DEST...HEAD")
\`\`\`
EOF
```

Fill the Summary paragraph yourself. A diff stat alone is not a description.

## Step 2.3: Body humanization gate (MUST)

The body file (`.ship-it-body.tmp.md` or whatever was passed via `--body`) must contain zero AI-writing tells before any POST or PUT.

```bash
grep -nE '—|^# [A-Z]|\*\*[^*]+\*\*: ' .ship-it-body.tmp.md
```

The three patterns the regex catches (em-dashes, title-case `# Headings`, inline-header `**Term:** body` bullets) are the highest-signal leaks. **If grep prints anything, fix and re-run before submitting.**

### Preferred: any humanize-capable skill

Scan the available skills list for one whose description mentions rewriting AI-writing tells, em-dashes, AI vocabulary, or "humanize"-style cleanup. In the published claude-skills catalogue this is `humanize:humanize`, but the rule is capability-based, any equivalent satisfies the gate. Invoke it and overwrite the body file with the result. Capable skills catalogue specific AI tells and rewrite against all of them, always preferred over a manual rewrite when available.

### Fallback: manual scrub

If no humanize-capable skill is installed, the agent rewrites by hand. Minimum scrub:

- Replace every `—` (em-dash) with a period, comma, colon, or parentheses per the relationship between clauses. No semicolons (also an AI tell).
- Sentence-case all `# Headings`, or remove the headings entirely if the section is short enough to read as prose.
- Collapse `- **Term:** sentence.` bullets into prose, or strip the bold and just write the sentence.
- Drop any rule-of-three patterns (`X, Y, and Z` triplets that aren't a literal count).
- Add at least one first-person sentence on a real decision (why scope is what it is, what was deliberately left out). Voice is the difference between clean-but-AI and human.

After the scrub, re-run the grep above. Clean grep means the gate passes. **Do not POST or PUT until clean.**

Why this is a hard requirement: agents reliably leak em-dashes, title-case headings, mechanical boldface, and inline-header bullets into PR descriptions. Reviewers notice. Authors who care notice harder.

## Step 2.4: PR-target sanity check (MUST before create)

```bash
git log --oneline "origin/$DEST..HEAD" | wc -l
```

If the count is much larger than the commits authored for this branch (the branch was rebased onto a non-`$DEST` base mid-work), stop and ask via `AskUserQuestion`:

- Target `$DEST` anyway (carries extras, only correct if the base lands first or extras are desirable).
- Target the actual rebase base so the PR diff is just this branch's work.
- Rework the branch (cherry-pick onto `$DEST`, squash) before creating.

Do NOT silently open a PR where the diff against the declared target is much larger than the branch's own changes.

## Step 2.5: Create draft PR

`bkt pr create` has no `--draft` flag. Route through the raw API:

```bash
PR_RESPONSE=$(bkt api "/repositories/$WORKSPACE/$REPO_SLUG/pullrequests" \
  -X POST \
  -d "$(jq -n \
    --arg title "$PR_TITLE" \
    --arg src "$BRANCH" \
    --arg dst "$DEST" \
    --arg body "$(cat .ship-it-body.tmp.md)" \
    '{title:$title,
      source:{branch:{name:$src}},
      destination:{branch:{name:$dst}},
      draft:true,
      close_source_branch:true,
      description:$body}')" \
  --json)

PR_ID=$(echo "$PR_RESPONSE" | jq -r '.id // empty')
PR_URL=$(echo "$PR_RESPONSE" | jq -r '.links.html.href // empty')
```

`PR_TITLE` defaults to the latest commit subject, `git log -1 --format=%s`. Override with the first line of a committed PR title file or with explicit user input.

If `PR_ID` is empty or non-numeric, the POST failed. Inspect `$PR_RESPONSE` for the error payload before proceeding. Common cause: invalid JSON in the body (Bitbucket sometimes echoes literal newlines back into the response, but the request itself rarely fails on body content; far more common is missing auth).

If `--ready` was passed instead of the default `--draft`, omit `draft:true` from the JSON above.

## Step 2.6: Update existing PR

```bash
bkt pr edit "$PR_ID" \
  --title "$PR_TITLE" \
  --body "$(cat .ship-it-body.tmp.md)"
```

If title is unchanged, omit `--title`.

## Step 2.7: Attach default reviewers

```bash
REVIEWERS=$(bkt api "/repositories/$WORKSPACE/$REPO_SLUG/default-reviewers" --json \
  --jq "[.values[] | select(.account_id != \"$USER_ACCOUNT_ID\") | {uuid: .uuid}]")

bkt api "/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID" \
  --method PUT \
  --input "{\"reviewers\": $REVIEWERS}" \
  --json
```

If `--reviewers <uuids>` was passed, use that list directly:

```bash
REVIEWERS=$(echo "$EXPLICIT_UUIDS" | tr ',' '\n' | jq -R '{uuid: .}' | jq -s '.')
```

Verify the PUT response contains the PR's `id`, that confirms it succeeded.

## Step 2.8: Print handoff lines

For parent skills (jira-workflow or similar) that need to capture state:

```
PR_ID=<id>
PR_URL=<url>
```

These two lines must be the last lines of the CREATE stage's stdout, exact format. Parent skills grep for them.

## Step 2.9: Cleanup

```bash
rm -f .ship-it-body.tmp.md
```

The body is now persisted in the PR. The temp file is dead weight in the working tree.

## Next

Stage 3 (FEEDBACK). Read `references/feedback.md`. Auto-advance, no pause.
