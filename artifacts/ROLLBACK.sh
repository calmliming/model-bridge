#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-artifacts/ROLLBACK_TEST_COPY.ts}"
SOURCE="${2:-artifacts/ROLLBACK_SOURCE.ts}"
cp "$SOURCE" "$TARGET"
sha256sum "$TARGET"
