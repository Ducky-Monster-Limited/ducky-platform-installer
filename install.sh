#!/bin/bash
# install.sh — the one line a new Mac runs (plan_0013):
#
#   curl -fsSL https://raw.githubusercontent.com/Ducky-Monster-Limited/ducky-platform-installer/main/install.sh | bash
#
# Xcode tools, Homebrew, nvm + node 26, the GitHub sign-in (gh, in the browser),
# the installer cloned into the install folder (<root>/installer), then
# the guided `ducky-pro install`. From a checkout: ./install.sh [--path <dir>].
# Every question reads the terminal, so it works piped from curl.
set -euo pipefail

repo="Ducky-Monster-Limited/ducky-platform-installer"
src="${BASH_SOURCE[0]:-}"
here=""
root=""
args=("$@")

# the answer of one question, from the terminal even when piped
ask() {

    local answer=""

    read -r -p "$1" answer < /dev/tty || true
    printf '%s' "$answer"

}

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
    echo "[err] the ducky-pro install needs macOS on Apple silicon"
    exit 1
fi

# XCODE TOOLS (git, compilers)

if ! xcode-select -p > /dev/null 2>&1; then
    echo "[plan] the Xcode command line tools: a macOS dialog opens, finish it"
    xcode-select --install > /dev/null 2>&1 || true
    while ! xcode-select -p > /dev/null 2>&1; do
        ask "       press enter once the Xcode tools are installed " > /dev/null
    done
fi

# HOMEBREW

if ! command -v brew > /dev/null 2>&1 && [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi

if ! command -v brew > /dev/null 2>&1; then
    if [[ "$(ask "[plan] Homebrew is missing: run its official install script (brew.sh)? [y/N] ")" != [yY] ]]; then
        echo "[skip] Homebrew declined, nothing installed"
        exit 1
    fi
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" < /dev/tty
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# NODE 26 (nvm, as the cloud images; an older node is never used)

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    echo "[plan] nvm: its official install script (v0.40.8), no shell profile touched"
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | PROFILE=/dev/null bash
fi

# (nvm.sh is not written for set -u)
set +u
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"
if ! nvm ls 26 > /dev/null 2>&1; then
    echo "[plan] node 26: nvm install 26"
    nvm install 26
fi
nvm use 26 > /dev/null
set -u

if [[ "$(node -v)" != v26.* ]]; then
    echo "[err] node 26 is needed, found $(node -v)"
    exit 1
fi

# GITHUB SIGN-IN (the org's repos are private; the ssh key step uses it)

if ! command -v gh > /dev/null 2>&1; then
    echo "[plan] the GitHub cli: brew install gh"
    brew install gh
fi

if ! gh auth status > /dev/null 2>&1; then
    echo "[plan] sign in to GitHub with the account in Ducky-Monster-Limited (the browser opens)"
    gh auth login --hostname github.com --git-protocol https --web --scopes admin:public_key < /dev/tty
fi

# THE INSTALL FOLDER

# (bash 3.2 on macOS: an empty array is "unbound" under set -u)
if [[ ${#args[@]} -gt 0 ]]; then
    for index in "${!args[@]}"; do
        if [[ "${args[$index]}" == "--path" || "${args[$index]}" == "--root" ]]; then
            root="${args[$((index + 1))]:-}"
        fi
    done
fi

if [[ -n "$src" && -f "$(dirname "$src")/bin/ducky-pro" ]]; then
    here="$(cd "$(dirname "$src")" && pwd)"
fi

if [[ -z "$root" && -z "$here" ]]; then
    root="$(ask "[ask]  install into [~/Workspace/ducky_pro]: ")"
    root="${root:-$HOME/Workspace/ducky_pro}"
    root="${root/#\~/$HOME}"
    args+=("--path" "$root")
fi

# THE INSTALLER ITSELF (a checkout runs as it is)

if [[ -z "$here" ]]; then
    here="$root/installer"
    if [[ -d "$here/.git" ]]; then
        git -C "$here" pull --ff-only --quiet
    else
        mkdir -p "$root"
        git clone --quiet "https://github.com/$repo.git" "$here"
    fi
fi

exec node "$here/bin/ducky-pro" install ${args[@]+"${args[@]}"} < /dev/tty
