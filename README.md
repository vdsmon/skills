# claude-skills

Personal Claude Code plugins by [@vdsmon](https://github.com/vdsmon).

Each skill ships as its own plugin so you can install only what you want.

## Install

Register the marketplace once:

```bash
/plugin marketplace add vdsmon/claude-skills
```

Then install whichever plugins you want:

```bash
/plugin install skill-polish@vdsmon-skills
/plugin install tokenomics@vdsmon-skills
/plugin install pre-compact@vdsmon-skills
/plugin install humanizer@vdsmon-skills
```

## Plugins

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

### `humanizer`

Remove signs of AI-generated writing from text. Detects and fixes patterns including inflated symbolism, promotional language, superficial -ing analyses, vague attributions, em dash overuse, rule of three, AI vocabulary words, negative parallelisms, and excessive conjunctive phrases. Based on Wikipedia's "Signs of AI writing" guide.

Trigger: `humanize`, `humanizer`, `sounds too AI`, `make this more human`, or when editing/reviewing text to reduce AI-writing tells.

Forked from [blader/humanizer](https://github.com/blader/humanizer) (MIT, Copyright © 2025 Siqi Chen). Not tracking upstream — contains local modifications. Upstream license retained at `plugins/humanizer/skills/humanizer/LICENSE`.

## Layout

```
.claude-plugin/
  marketplace.json           # Lists all plugins shipped by this marketplace
plugins/
  skill-polish/
    .claude-plugin/plugin.json
    skills/skill-polish/SKILL.md
  tokenomics/
    .claude-plugin/plugin.json          # Declares SessionStart hook
    skills/tokenomics/SKILL.md + scripts/token-report.py
    hooks/tokenomics-keepalive.sh       # Opt-in, flag-gated
  pre-compact/
    .claude-plugin/plugin.json
    skills/pre-compact/SKILL.md
  humanizer/
    .claude-plugin/plugin.json
    skills/humanizer/SKILL.md + README.md + LICENSE
```

## Migrating from v0.x (monolithic `vdsmon-skills` plugin)

Earlier versions shipped a single `vdsmon-skills` plugin bundling all skills. If you installed that, uninstall and reinstall only what you want:

```bash
claude plugin uninstall vdsmon-skills@vdsmon-skills
claude plugin install tokenomics@vdsmon-skills
# ... etc
```

## License

MIT — see [LICENSE](LICENSE). The humanizer plugin contains a vendored MIT-licensed skill from blader/humanizer; that license is preserved alongside the skill.
