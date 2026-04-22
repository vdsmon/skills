# claude-skills

Personal Claude Code skills by [@vdsmon](https://github.com/vdsmon).

## Install

```
/plugin marketplace add vdsmon/claude-skills
/plugin install vdsmon-skills@vdsmon-skills
```

## Skills

### `skill-polish`

Post-mortem for any skill. Scans the conversation for friction (corrections, skipped steps, rejected tool calls), traces each to the responsible skill file, and applies concrete edits.

Trigger: `skill-polish`, `polish the skill`, `improve the skill`, `that should have been automatic`, `you skipped X`, `close the gaps`.

Works on any skill, not just its own.

### `tokenomics`

Analyze Claude Code token usage, cache hit rates, and Max plan consumption. Ships with `scripts/token-report.py` for lightweight per-session reporting.

Trigger: `tokenomics`, `how much have I used`, `cache stats`, `am I going to hit the limit`, `show my usage`, or any question about token/plan consumption.

**Optional cache keepalive (Max plan):** touch `~/.tokenomics-keepalive` to opt in. On every session start the plugin emits an instruction that schedules `/loop <interval> python3 .../token-report.py` so the prompt cache stays warm (1h TTL).

- Interval defaults to `30m`. Override by writing it on the first line of the flag file, e.g. `echo 4m > ~/.tokenomics-keepalive`.
- Format: `<digits><s|m|h|d>` (e.g. `90s`, `4m`, `2h`). Invalid values silently fall back to `30m`.
- No flag file = no hook output, no loop. `rm ~/.tokenomics-keepalive` to disable.

### `pre-compact`

Audit in-flight session state before `/compact` truncates context. Flags uncommitted git changes, scratch files, unfinished plans, running background tasks. Produces a copy-paste focus message for the next session.

Trigger: `compact`, `let's compact`, `ready to compact?`, `prep for compact`, `suggest a compact message`.

## Layout

```
.claude-plugin/
  plugin.json          # Plugin manifest (declares SessionStart hook)
  marketplace.json     # Self-hosted marketplace entry
hooks/
  tokenomics-keepalive.sh  # Opt-in SessionStart hook (flag-gated)
skills/
  skill-polish/
    SKILL.md
  tokenomics/
    SKILL.md
    scripts/
      token-report.py
  pre-compact/
    SKILL.md
```

## License

MIT — see [LICENSE](LICENSE).
