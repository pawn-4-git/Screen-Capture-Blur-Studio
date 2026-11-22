#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

zip -r screen-capture-editor.zip screen-capture-editor -x "*.DS_Store" -x "*__MACOSX*"
