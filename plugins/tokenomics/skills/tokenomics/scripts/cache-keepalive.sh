#!/bin/sh
# No-op. Exists so the scheduled cron fires a Bash tool call, which is
# an API turn against the cached prompt prefix — that read resets the
# 1h cache TTL. Script output is irrelevant; only the tool call matters.
exit 0
