#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
NODE_BIN=$("$SCRIPT_DIR/bootstrap-runtime.sh")
NODE_BIN_DIR=$(dirname -- "$NODE_BIN")

PRIVATE_NODE_VERSION=$("$NODE_BIN" --version)
if [ "$PRIVATE_NODE_VERSION" != "v26.13.0" ]; then
  printf 'Pinned private Node 26.13.0 is unavailable\n' >&2
  exit 1
fi
if [ "$#" -eq 0 ]; then
  printf 'Usage: scripts/dev.sh <npm arguments>\nExamples:\n  scripts/dev.sh test\n  scripts/dev.sh run demo -- --output /tmp/hackutd-demo\n' >&2
  exit 2
fi

cd "$PROJECT_ROOT"
PATH="$NODE_BIN_DIR:$PATH"
export PATH
exec "$NODE_BIN_DIR/npm" "$@"
