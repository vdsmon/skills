"""Print the cc-autotitle fork prompt as register.ts builds it: python3 prompt.py <register.ts> <current> <hint>."""
import re
import sys

src, current, hint = open(sys.argv[1]).read(), sys.argv[2], sys.argv[3]


def grab(pattern: str) -> str:
    m = re.search(pattern, src, re.S)
    if m is None:
        sys.exit(f"prompt.py: register.ts no longer matches {pattern!r}")
    return m.group(1)


text = grab(r"const PROMPT = `(.*?)`")
if hint:
    text += "\n\n" + grab(r"parts\.push\(`(The user asks for a name[^`]*)`\)").replace("${hint}", hint)
elif current:
    text += "\n\n" + grab(r"parts\.push\(`(The session is now named \$\{current\}[^`]*)`\)").replace("${current}", current)
print(text)
