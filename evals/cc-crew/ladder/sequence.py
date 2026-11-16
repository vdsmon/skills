"""Print the order of tool calls in a print-mode transcript, marking each one allowed or denied,
and every system event between them. Usage: sequence.py <out.jsonl>"""
import json
import sys

uses, order = {}, []
for line in open(sys.argv[1], errors="ignore"):
    try:
        d = json.loads(line)
    except ValueError:
        continue
    if not isinstance(d, dict):
        continue
    kind = d.get("type")
    if kind == "system":
        order.append(("system", d.get("subtype"), ""))
        continue
    msg = d.get("message")
    content = msg.get("content") if isinstance(msg, dict) else None
    side = bool(d.get("parent_tool_use_id"))
    for b in content if isinstance(content, list) else []:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "tool_use":
            inp = b.get("input", {})
            what = inp.get("command") or inp.get("skill") or inp.get("subagent_type") or inp.get("file_path") or ""
            uses[b.get("id")] = len(order)
            order.append(["sub" if side else "main", b.get("name"), str(what)[-70:].replace("\n", " "), "?"])
        elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses:
            c = b.get("content")
            text = c if isinstance(c, str) else " ".join(x.get("text", "") for x in c if isinstance(x, dict)) if isinstance(c, list) else ""
            order[uses[b["tool_use_id"]]][3] = "DENIED" if "requires approval" in text else "ok"
for row in order:
    print(" | ".join(str(x) for x in row))
