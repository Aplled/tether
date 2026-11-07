#!/bin/sh
set -eu

RUNTIME_VERSION="26.13.0"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
TOOLCHAIN_ROOT="$PROJECT_ROOT/.runtime/toolchains"
SYSTEM_NAME=$(uname -s)
MACHINE_ARCH=$(uname -m)

if [ "$SYSTEM_NAME" != "Darwin" ]; then
  printf 'Unsupported operating system: %s (this bootstrap supports macOS only)\n' "$SYSTEM_NAME" >&2
  exit 1
fi

case "$MACHINE_ARCH" in
  arm64)
    RUNTIME_ARCH="arm64"
    EXPECTED_SHA256="d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6"
    ;;
  x86_64)
    RUNTIME_ARCH="x64"
    EXPECTED_SHA256="525c9b29bb0263d687de60a4cec0e2a6db876a8eb032369e5795eca71e7c358e"
    ;;
  *)
    printf 'Unsupported macOS architecture: %s\n' "$MACHINE_ARCH" >&2
    exit 1
    ;;
esac

ARCHIVE_NAME="node-v${RUNTIME_VERSION}-darwin-${RUNTIME_ARCH}.tar.gz"
EXTRACTED_NAME="node-v${RUNTIME_VERSION}-darwin-${RUNTIME_ARCH}"
INSTALL_DIR="$TOOLCHAIN_ROOT/$EXTRACTED_NAME"
NODE_BIN="$INSTALL_DIR/bin/node"
DOWNLOAD_URL="https://nodejs.org/dist/v${RUNTIME_VERSION}/${ARCHIVE_NAME}"

if [ -x "$NODE_BIN" ]; then
  INSTALLED_VERSION=$("$NODE_BIN" --version)
  if [ "$INSTALLED_VERSION" != "v${RUNTIME_VERSION}" ]; then
    printf 'Unexpected private Node version at %s: %s\n' "$NODE_BIN" "$INSTALLED_VERSION" >&2
    exit 1
  fi
  printf '%s\n' "$NODE_BIN"
  exit 0
fi

mkdir -p "$TOOLCHAIN_ROOT"
chmod 700 "$PROJECT_ROOT/.runtime" "$TOOLCHAIN_ROOT"
WORK_DIR=$(mktemp -d "$TOOLCHAIN_ROOT/.bootstrap.XXXXXX")
ARCHIVE_PATH="$WORK_DIR/$ARCHIVE_NAME"
cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT HUP INT TERM

curl --fail --location --silent --show-error --connect-timeout 20 --max-time 300 --proto '=https' --tlsv1.2 --output "$ARCHIVE_PATH" "$DOWNLOAD_URL"
ACTUAL_SHA256=$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  printf 'Node archive checksum mismatch: expected %s, got %s\n' "$EXPECTED_SHA256" "$ACTUAL_SHA256" >&2
  exit 1
fi

tar -xzf "$ARCHIVE_PATH" -C "$WORK_DIR"
if [ ! -x "$WORK_DIR/$EXTRACTED_NAME/bin/node" ]; then
  printf 'Verified archive did not contain the expected Node executable\n' >&2
  exit 1
fi
mv "$WORK_DIR/$EXTRACTED_NAME" "$INSTALL_DIR"
EXTRACTED_VERSION=$("$NODE_BIN" --version)
if [ "$EXTRACTED_VERSION" != "v${RUNTIME_VERSION}" ]; then
  printf 'Extracted private Node failed version verification\n' >&2
  exit 1
fi
printf '%s\n' "$NODE_BIN"
