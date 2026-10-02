"""Tests for the open-pr body checker. Run: python3 -m unittest discover -s plugins/open-pr/tests"""

import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
SCRIPT = HERE.parent / "skills" / "open-pr" / "scripts" / "pr_body_check.py"
spec = importlib.util.spec_from_file_location("pr_body_check", SCRIPT)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def rules(text, base=None, level=None):
    findings, _ = checker.check(text, base)
    return {r for lvl, r, _, _ in findings if level in (None, lvl)}


def prose(n):
    return " ".join(["word"] * (n - 1)) + " end."


class Fixtures(unittest.TestCase):
    def test_good_body_passes_clean(self):
        findings, words = checker.check((HERE / "fixtures" / "good.md").read_text())
        self.assertEqual(findings, [])
        self.assertLess(words, 150)

    def test_changelog_body_fails_on_each_tell(self):
        failed = rules((HERE / "fixtures" / "changelog.md").read_text(), level="FAIL")
        self.assertTrue({"opening", "summary-heading", "file-list", "bold-label", "typography",
                         "semicolon", "local-path", "attribution"} <= failed, failed)

    def test_cli_exit_codes(self):
        run = lambda name: subprocess.run(["python3", str(SCRIPT), str(HERE / "fixtures" / name)],
                                          capture_output=True, text=True)
        good, bad = run("good.md"), run("changelog.md")
        self.assertEqual(good.returncode, 0, good.stdout)
        self.assertIn("pass", good.stdout.splitlines()[-1])
        self.assertEqual(bad.returncode, 1)


class Length(unittest.TestCase):
    def test_cap_counts_only_prose(self):
        self.assertNotIn("prose-length", rules(prose(290)))
        self.assertIn("prose-length", rules(prose(310)))

    def test_code_tables_details_and_bot_sections_do_not_count(self):
        long = prose(400)
        body = (prose(40) + "\n\n```\n" + long + "\n```\n\n| a |\n|---|\n| " + long + " |\n\n"
                "<details>\n<summary>x</summary>\n\n" + long + "\n\n</details>\n\n"
                "<!-- BOT -->\n" + long + " — **bold**; x\n<!-- /BOT -->\n")
        findings, words = checker.check(body)
        self.assertEqual(findings, [])
        self.assertEqual(words, 40)

    def test_inline_code_is_not_counted(self):
        _, words = checker.check("Run `a b c d e f` now.")
        self.assertEqual(words, 2)

    def test_long_opening_warns(self):
        self.assertIn("opening-length", rules(prose(70), level="WARN"))


class Shape(unittest.TestCase):
    def test_hand_wrapped_prose_fails(self):
        self.assertIn("hand-wrap", rules("The report groups lines by hour and\nby day, as before.\n"))
        self.assertNotIn("hand-wrap", rules("One sentence.\nAnother sentence.\n"))

    def test_file_bullets_fail_only_when_they_dominate(self):
        files = "Intro.\n\n## What changes\n\n- `a/b.py`: x.\n- `c/d.py`: y.\n- A behavior.\n"
        self.assertIn("file-list", rules(files))
        mixed = "Intro.\n\n## What changes\n\n- `a/b.py` moves to `c/`.\n- A behavior.\n- Another one.\n"
        self.assertNotIn("file-list", rules(mixed))

    def test_too_many_sections_fail(self):
        body = "Intro.\n\n" + "".join(f"## S{i}\n\nText.\n\n" for i in range(5))
        self.assertIn("headings", rules(body, level="FAIL"))

    def test_local_path_fails_even_in_code(self):
        self.assertIn("local-path", rules("Intro.\n\n```\ncd ~/work/app\n```\n"))
        self.assertNotIn("local-path", rules("Intro with `/usr/bin/env` and a/~/b."))

    def test_semicolon_in_code_or_entity_is_fine(self):
        self.assertNotIn("semicolon", rules("Run `a; b` and see &amp; here."))

    def test_mentions_and_late_asks_warn(self):
        body = "Intro.\n\nSecond.\n\n## Open questions\n\n- @dana, please review the parser before merging.\n"
        warned = rules(body, level="WARN")
        self.assertIn("mention", warned)
        self.assertIn("ask-late", warned)
        self.assertNotIn("mention", rules("Mail me at a@example.com or see `@decorator`."))

    def test_tagging_the_author_fails(self):
        body = "Intro.\n\n@dana handed this over to @sam.\n"
        failed = [r for lv, r, _, _ in checker.check(body, author="Sam")[0] if lv == "FAIL"]
        self.assertEqual(failed, ["self-mention"])
        self.assertNotIn("self-mention", rules(body))


class Paths(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cwd = os.getcwd()
        os.chdir(self.tmp.name)
        g = lambda *a: subprocess.run(["git", *a], check=True, capture_output=True)
        g("init", "-q", "-b", "main")
        g("config", "user.email", "t@example.com")
        g("config", "user.name", "t")
        Path("src").mkdir()
        Path("src/old.py").write_text("x = 1\n")
        Path("README.md").write_text("r\n")
        g("add", ".")
        g("commit", "-qm", "base")
        g("checkout", "-qb", "feature")
        g("mv", "src/old.py", "src/new.py")
        g("commit", "-qm", "rename")

    def tearDown(self):
        os.chdir(self.cwd)
        self.tmp.cleanup()

    def test_paths_checked_against_head_and_diff(self):
        body = ("Intro.\n\n- `src/new.py` replaces `src/old.py`. See `README.md`.\n"
                "- Rebase `feat/other` and look in `out/report.json`.\n- `src/gone.py` is fine.\n")
        findings, _ = checker.check(body, base="main")
        warned = [m for lvl, r, _, m in findings if r == "path"]
        self.assertEqual(len(warned), 1, warned)
        self.assertIn("src/gone.py", warned[0])
        self.assertTrue(all(lvl == "WARN" for lvl, r, _, _ in findings if r == "path"))

    def test_bad_base_warns_instead_of_crashing(self):
        findings, _ = checker.check("Intro `src/new.py`.", base="nope")
        self.assertIn("path-check", {r for _, r, _, _ in findings})


if __name__ == "__main__":
    unittest.main()
