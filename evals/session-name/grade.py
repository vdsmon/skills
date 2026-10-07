"""Grade session-name eval answers: python3 grade.py <iteration-dir> (eval-N-<case>/<config>/run-*/outputs/answer.md)."""
import json
import re
import sys
from pathlib import Path

LINE = re.compile(r"^(Option \d+: )?`/rename ([a-z0-9-]+)`$")

SPECIFIC = {
    "drift": ("Name is about the feed cursor fix, not the ruff side question",
              lambda ns: bool(ns) and all(("feed" in n or "cursor" in n or "pr-31" in n) and "ruff" not in n for n in ns)),
    "split": ("Options cover both threads: the batch cost comparison and the QA rubric v3 post",
              lambda ns: any(("cost" in n or "88" in n or "90" in n) for n in ns) and any("rubric" in n for n in ns)),
    "portuguese": ("Name keeps the ticket key rev-2210 and mentions uv",
                   lambda ns: bool(ns) and all("rev-2210" in n and "uv" in n for n in ns)),
}
COUNT = {"drift": (1, 1), "split": (2, 3), "portuguese": (1, 1)}


def grade(run_dir: Path, case: str) -> dict:
    text = (run_dir / "outputs" / "answer.md").read_text().strip()
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    matches = [LINE.match(l) for l in lines]
    # Content checks use a loose parse so a wrong format does not also fail them.
    names = re.findall(r"/rename ([a-z0-9-]+)", text)
    lo, hi = COUNT[case]
    spec_text, spec_fn = SPECIFIC[case]
    checks = [
        ("Reply contains only /rename lines, nothing else",
         bool(lines) and all(matches),
         f"{len(lines)} non-empty lines; non-matching: {[l for l, m in zip(lines, matches) if not m][:3]}"),
        ("Every name is kebab case, 2 to 6 words, at most 45 characters",
         bool(names) and all(2 <= len(n.split('-')) <= 6 and len(n) <= 45 for n in names),
         f"names: {names}"),
        (f"Gives {lo} option(s)" if lo == hi else f"Gives {lo} to {hi} options",
         lo <= len(names) <= hi, f"{len(names)} names found"),
        (spec_text, spec_fn(names), f"names: {names}"),
    ]
    exp = [{"text": t, "passed": bool(p), "evidence": e} for t, p, e in checks]
    passed = sum(e["passed"] for e in exp)
    return {"expectations": exp,
            "summary": {"passed": passed, "failed": len(exp) - passed, "total": len(exp),
                        "pass_rate": round(passed / len(exp), 2)}}


def main(iteration: Path) -> None:
    for eval_dir in sorted(iteration.glob("eval-*")):
        case = eval_dir.name.split("-", 2)[2]
        for run_dir in sorted(eval_dir.glob("*/run-*")):
            if not (run_dir / "outputs" / "answer.md").exists():
                print(f"missing: {run_dir}")
                continue
            g = grade(run_dir, case)
            (run_dir / "grading.json").write_text(json.dumps(g, indent=2))
            print(f"{eval_dir.name}/{run_dir.parent.name}: {g['summary']['passed']}/{g['summary']['total']}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
