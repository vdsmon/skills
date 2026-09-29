#!/usr/bin/env bash
# Offline suite for open-pr: the body checker's unit tests (stdlib unittest, no network).
set -u
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
python3 -m unittest -v test_pr_body_check 2>&1
