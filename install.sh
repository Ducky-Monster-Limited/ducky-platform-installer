#!/bin/bash
# install.sh — the bootstrap: Xcode tools, Homebrew, node, then
# `bin/ducky install` (guided: shows each step, asks before it applies).
#   ./install.sh            release mode (asks for your release token)
#   ./install.sh --dev      dev mode (git clones; Marc's machines)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
    echo "[err] the ducky install needs macOS on Apple silicon"
    exit 1
fi

if ! xcode-select -p > /dev/null 2>&1; then
    echo "[plan] the Xcode command line tools are missing: a macOS dialog opens, finish it, then run ./install.sh again"
    xcode-select --install || true
    exit 1
fi

if ! command -v brew > /dev/null 2>&1; then
    read -r -p "[plan] Homebrew is missing: run its official install script (brew.sh)? [y/N] " answer
    if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
        echo "[skip] Homebrew declined, nothing installed"
        exit 1
    fi
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi

if ! command -v node > /dev/null 2>&1; then
    echo "[plan] node 20: brew install node@20"
    brew install node@20
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
fi

exec node "$here/bin/ducky" install "$@"
