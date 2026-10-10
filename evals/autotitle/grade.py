"""Grade cc-autotitle eval replies: python3 grade.py <out-dir> (<case>-<n>.txt, as run.sh writes them)."""
import json
import re
import sys
from pathlib import Path

# The mod's own check (register.ts parse): one pair of backticks allowed, then a bare name.
NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+){1,9}$")

SPECIFIC = {
    "drift": ("Name is about the feed cursor fix, not the ruff side question",
              lambda n: ("feed" in n or "cursor" in n or "pr-31" in n) and "ruff" not in n),
    "split": ("Name covers one of the threads: the batch cost comparison or the QA rubric v3 post",
              lambda n: "cost" in n or "88" in n or "90" in n or "rubric" in n),
    "portuguese": ("Name keeps the ticket key rev-2210 and mentions uv",
                   lambda n: "rev-2210" in n and "uv" in n),
    "keep": ("A current name that still fits comes back unchanged",
             lambda n: n == "pr-31-feed-cursor-fix"),
    "move": ("A current name about the side question is replaced by one about the cursor fix",
             lambda n: ("feed" in n or "cursor" in n or "pr-31" in n) and "ruff" not in n),
}


def parse(text: str) -> str | None:
    t = text.strip()
    if t.startswith("`") and t.endswith("`") and t.count("`") == 2:
        t = t[1:-1]
    return t if len(t) <= 40 and NAME.match(t) else None


def grade(path: Path, case: str) -> dict:
    name = parse(path.read_text())
    spec_text, spec_fn = SPECIFIC[case]
    checks = [
        ("Reply is one bare kebab-case name, 2 to 10 parts, at most 40 characters", name is not None,
         path.read_text().strip()[:80]),
        (spec_text, name is not None and spec_fn(name), str(name)),
    ]
    exp = [{"text": t, "passed": bool(p), "evidence": e} for t, p, e in checks]
    return {"name": name, "expectations": exp, "passed": all(e["passed"] for e in exp)}


def main(out: Path) -> None:
    results = {}
    for path in sorted(out.glob("*.txt")):
        case = path.stem.rsplit("-", 1)[0]
        g = grade(path, case)
        results[path.stem] = g
        print(f"{path.stem}: {'PASS' if g['passed'] else 'FAIL'} {g['name'] or path.read_text().strip()[:60]!r}")
    (out / "grading.json").write_text(json.dumps(results, indent=2))
    print(f"{sum(g['passed'] for g in results.values())}/{len(results)} passed")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
