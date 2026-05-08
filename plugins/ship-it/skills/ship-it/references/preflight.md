# Pre-flight: config setup

ship-it needs a small config to know which Bitbucket workspace and repo to talk to. Two scopes:

- **User config** (`SKILL_DIR/config.toml`): your Bitbucket account ID. Same across all projects.
- **Project config** (`<repo-root>/.ship-it.toml`): workspace, repo slug, default target branch. Per-project.

If `python3 SKILL_DIR/scripts/load-config.py SKILL_DIR` exits non-zero, one of the files below is missing or incomplete. The loader prints which key. Fill it, re-run.

## User config (`SKILL_DIR/config.toml`)

```toml
[reviewers]
user_account_id = "<your-bitbucket-account-id>"
```

Your Bitbucket account ID is visible in the URL of your Bitbucket profile page, or via:

```bash
bkt api /user --json | jq -r .account_id
```

Used to filter you out of the default reviewer list at PR-create time.

## Project config (`<repo-root>/.ship-it.toml`)

```toml
[vcs]
workspace = "<bitbucket-workspace>"
repo_slug = "<bitbucket-repo-slug>"
default_target = "dev"           # optional, defaults to "dev"
cli = "bkt"                      # optional, only "bkt" supported in v0.1

[reviewer_bot]
name = "coderabbit"              # optional, only "coderabbit" supported in v0.1
```

`workspace` and `repo_slug` are visible in any Bitbucket repo URL: `https://bitbucket.org/<workspace>/<repo_slug>/`.

## Why two files

User config holds your account ID, which is yours across every repo. Project config holds the repo-specific bits, which travel with the repo. If you commit `.ship-it.toml`, every contributor on the repo gets the right defaults; if you keep it gitignored, each contributor sets their own.

## After setup

Re-run the original `/ship-it` invocation. The loader's exit 0 path is silent.
