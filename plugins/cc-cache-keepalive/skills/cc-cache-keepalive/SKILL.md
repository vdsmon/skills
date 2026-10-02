---
name: cc-cache-keepalive
disable-model-invocation: true
description: Arms a silent cron in this session that keeps the prompt cache warm while you are away. Use it in long-lived sessions only; ticks a recent turn or a cold cache makes pointless are cancelled by the plugin's hooks.
---

!`bash "${CLAUDE_SKILL_DIR}/scripts/keepalive.sh"`

Follow the block above exactly. Never guess or reuse a cron expression from memory or an old transcript: the anchor minute keeps the ticks off the fleet peaks.
