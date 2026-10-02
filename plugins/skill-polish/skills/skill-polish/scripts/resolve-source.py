#!/usr/bin/env python3
"""Map a loaded skill file to the file you should edit.

Plugin caches and marketplace clones are install copies: the next plugin
update overwrites them, so an edit there is lost and never reaches the repo.
This finds the local source checkout of the file's marketplace and prints the
matching path there.

Usage: resolve-source.py <path> [--checkout DIR]

Prints "key: value" lines. status is one of:
  source       the path is not an install copy; edit it where it is
  mapped       an install copy; edit the "edit:" path in the checkout
  no-checkout  an install copy, and no local checkout of its source was found
Exit: 0 source/mapped, 3 no-checkout, 2 usage error.
"""

import json
import os
import re
import sys
from pathlib import Path

HOME = Path.home()
CLAUDE_DIR = HOME / ".claude"
CODEX_DIR = Path(os.environ.get("CODEX_HOME") or HOME / ".codex")
SEARCH_ROOTS = [
    "repos",
    "src",
    "code",
    "projects",
    "dev",
    "work",
    "git",
    "github",
    "Developer",
    "workspace",
]
SKIP_DIRS = {
    "node_modules",
    "Library",
    "vendor",
    "target",
    "dist",
    "build",
    "__pycache__",
}
MAX_DEPTH = 4


def out(**kv):
    for k, v in kv.items():
        if v is not None:
            print(f"{k}: {v}")


def norm_remote(url):
    u = url.strip()
    u = re.sub(r"^(git\+)?(https?|ssh|git)://", "", u)
    u = re.sub(r"^[^@/]+@", "", u)
    if re.match(r"^[^/]+:[^/]", u):
        u = u.replace(":", "/", 1)
    u = re.sub(r"\.git/?$", "", u).rstrip("/")
    return u.lower()


def classify(p):
    """Return (kind, marketplace, plugin, rest, clone_dir) for an install copy, else None."""
    layouts = [
        (
            "cache",
            CLAUDE_DIR / "plugins" / "cache",
            CLAUDE_DIR / "plugins" / "marketplaces",
        ),
        ("cache", CODEX_DIR / "plugins" / "cache", CODEX_DIR / ".tmp" / "marketplaces"),
        ("clone", CLAUDE_DIR / "plugins" / "marketplaces", None),
        ("clone", CODEX_DIR / ".tmp" / "marketplaces", None),
    ]
    for kind, base, clones in layouts:
        try:
            parts = p.relative_to(base.resolve()).parts
        except ValueError:
            continue
        if kind == "cache" and len(parts) >= 4:
            mkt, plugin = parts[0], parts[1]
            return kind, mkt, plugin, Path(*parts[3:]), clones / mkt
        if kind == "clone" and len(parts) >= 2:
            return kind, parts[0], None, Path(*parts[1:]), base / parts[0]
    for base in (CLAUDE_DIR / "plugins", CODEX_DIR / "plugins", CODEX_DIR / ".tmp"):
        try:
            p.relative_to(base.resolve())
            return "unknown", None, None, None, None
        except ValueError:
            pass
    return None


def git_config_path(repo):
    """Path of the git config for a checkout or a worktree, or None."""
    dotgit = repo / ".git"
    if dotgit.is_dir():
        return dotgit / "config"
    if dotgit.is_file():
        m = re.match(r"gitdir:\s*(.+)", dotgit.read_text().strip())
        if not m:
            return None
        gitdir = (repo / m.group(1)).resolve()
        common = gitdir / "commondir"
        if common.is_file():
            gitdir = (gitdir / common.read_text().strip()).resolve()
        return gitdir / "config"
    return None


def remotes_of(repo):
    cfg = git_config_path(repo)
    if not cfg or not cfg.is_file():
        return set()
    return {
        norm_remote(u)
        for u in re.findall(r"^\s*url\s*=\s*(\S+)", cfg.read_text(), re.MULTILINE)
    }


def marketplace_source(mkt, clone_dir):
    """Return (remote, local_dir) for a marketplace name."""
    known = CLAUDE_DIR / "plugins" / "known_marketplaces.json"
    try:
        src = json.loads(known.read_text()).get(mkt, {}).get("source", {})
    except (OSError, ValueError):
        src = {}
    if src.get("path") or src.get("source") == "directory":
        return None, src.get("path")
    if src.get("url"):
        return norm_remote(src["url"]), None
    if src.get("repo"):
        return norm_remote(f"github.com/{src['repo']}"), None
    cfg = CODEX_DIR / "config.toml"
    if cfg.is_file():
        text = cfg.read_text()
        block = re.search(
            r'^\[\s*"?marketplaces"?\s*\.\s*"?'
            + re.escape(mkt)
            + r'"?\s*\]\s*$(.*?)(?=^\[|\Z)',
            text,
            re.MULTILINE | re.DOTALL,
        )
        if block:
            stype = re.search(
                r'^\s*"?source_type"?\s*=\s*"([^"]*)"', block.group(1), re.MULTILINE
            )
            source = re.search(
                r'^\s*"?source"?\s*=\s*"([^"]*)"', block.group(1), re.MULTILINE
            )
            if source:
                if stype and stype.group(1) == "local":
                    return None, source.group(1)
                return norm_remote(source.group(1)), None
    if clone_dir and clone_dir.is_dir():
        remotes = remotes_of(clone_dir)
        if remotes:
            return min(remotes), None
    return None, None


def is_install(d, installs):
    d = d.resolve()
    return any(d == i or i in d.parents for i in installs)


def find_checkout(remote, installs):
    """Look for a local git checkout whose remote matches. The cwd's repo wins."""
    cwd = Path.cwd().resolve()
    for d in [cwd, *cwd.parents]:
        if (d / ".git").exists():
            if remote in remotes_of(d) and not is_install(d, installs):
                return d
            break
    for name in SEARCH_ROOTS + [""]:
        root = HOME / name if name else HOME
        if not root.is_dir():
            continue
        depth_cap = MAX_DEPTH if name else 2
        for dirpath, dirnames, _ in os.walk(root):
            here = Path(dirpath)
            depth = len(here.relative_to(root).parts)
            if (here / ".git").is_dir():
                if remote in remotes_of(here) and not is_install(here, installs):
                    return here
                dirnames[:] = []
                continue
            if depth >= depth_cap:
                dirnames[:] = []
                continue
            dirnames[:] = [
                d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS
            ]
    return None


def plugin_dir(checkout, plugin):
    """Relative plugin directory inside a marketplace checkout."""
    for rel, key in (
        (".claude-plugin/marketplace.json", None),
        (".agents/plugins/marketplace.json", "path"),
    ):
        try:
            data = json.loads((checkout / rel).read_text())
        except (OSError, ValueError):
            continue
        for entry in data.get("plugins", []):
            if entry.get("name") != plugin:
                continue
            src = entry.get("source")
            if isinstance(src, dict):
                src = src.get(key or "path")
            if isinstance(src, str) and not re.match(r"^[a-z]+://", src):
                return Path(src)
    if (checkout / "plugins" / plugin).is_dir():
        return Path("plugins") / plugin
    return None


def main(argv):
    args = list(argv)
    checkout = None
    if "--checkout" in args:
        i = args.index("--checkout")
        if i + 1 >= len(args):
            print(__doc__, file=sys.stderr)
            return 2
        checkout = Path(args[i + 1]).expanduser().resolve()
        del args[i : i + 2]
    if len(args) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    path = Path(args[0]).expanduser().resolve()

    hit = classify(path)
    if hit is None:
        out(status="source", edit=path)
        return 0
    kind, mkt, plugin, rest, clone_dir = hit
    if kind == "unknown":
        out(
            status="no-checkout",
            file=path,
            note="install copy with an unknown layout; ask the user where its source is",
        )
        return 3

    remote, local_dir = marketplace_source(mkt, clone_dir)
    # Hosts register their bundled marketplaces as "local" sources that point
    # into their own managed dirs; those are install copies, not checkouts.
    installs = [
        d.resolve()
        for d in (
            CLAUDE_DIR / "plugins",
            CODEX_DIR / "plugins",
            CODEX_DIR / ".tmp",
            HOME / ".cache",
        )
    ]
    if checkout is None and local_dir:
        local = Path(local_dir).expanduser().resolve()
        if not is_install(local, installs):
            checkout = local
    if checkout is None and remote:
        checkout = find_checkout(remote, installs)
    if checkout is None or not checkout.is_dir():
        out(
            status="no-checkout",
            file=path,
            marketplace=mkt,
            plugin=plugin,
            remote=remote or "unknown",
            note="edits here are lost on the next update; rerun with --checkout DIR if a local clone exists",
        )
        return 3

    if kind == "cache":
        pdir = plugin_dir(checkout, plugin)
        if pdir is None:
            out(
                status="no-checkout",
                file=path,
                marketplace=mkt,
                plugin=plugin,
                checkout=checkout,
                note=f"checkout has no local source for plugin '{plugin}'",
            )
            return 3
        edit = checkout / pdir / rest
    else:
        edit = checkout / rest
        pdir = (
            Path(*rest.parts[:2])
            if len(rest.parts) > 2 and rest.parts[0] == "plugins"
            else None
        )
        plugin = pdir.name if pdir else None

    rules = [
        n
        for n in ("CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md")
        if (checkout / n).is_file()
    ]
    release = (
        f"follow the version and commit rule in {', '.join(rules)}" if rules else None
    )
    if plugin and (checkout / "scripts" / "bump-plugin.sh").is_file():
        release = f"scripts/bump-plugin.sh {plugin} <patch|minor|major> from the checkout, then commit ({release or 'no rule file found'})"
    out(
        status="mapped",
        file=path,
        marketplace=mkt,
        plugin=plugin,
        checkout=checkout,
        edit=edit,
        exists="yes"
        if edit.exists()
        else "no (renamed or removed in the checkout; find its new home)",
        release=release,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
