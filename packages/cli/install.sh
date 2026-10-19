#!/bin/sh
# =====================================================================
# CLIRevenue — one-line installer
# ---------------------------------------------------------------------
#   curl -fsSL https://clirevenue.com/install.sh | sh
#
# This script exists because of a plain fact: `npx` is how you run the
# CLIRevenue CLI, so the CLI cannot install Node for you — there would be
# nothing left running to do it. Anything that needs Node before the CLI
# exists has to be a shell script, which is what this is.
#
# It does the least it can and says what it is doing at every step:
#
#   1. look for Node 18+ (the CLI's floor, engines.node >= 18)
#   2. if it is missing or too old, install it the way THIS machine
#      installs things — nvm, Homebrew, or apt on WSL/Debian
#   3. run the CLI, passing any arguments through
#
# No arguments means `setup`. `sh install.sh --help` passes --help
# straight to the CLI.
#
# Design rule for this file: never fail silently. Every branch that does
# not install something says exactly what to run by hand instead. The
# audience is somebody who has never used a terminal, so "permission
# denied" with no next step is the worst possible output.
# =====================================================================

set -eu

MIN_MAJOR=18

say()  { printf '%s\n' "$*"; }
step() { printf '\n\033[1m›\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗\033[0m %s\n\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------
# 1. Do we already have a Node new enough?
# ---------------------------------------------------------------------
# Compared by major version, numerically. A string compare puts "9" above
# "18", which is the sort of bug that makes a perfectly good machine look
# broken.
node_major() {
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0'
}

node_is_new_enough() {
  have node || return 1
  have npx || return 1
  [ "$(node_major)" -ge "$MIN_MAJOR" ] 2>/dev/null || return 1
  return 0
}

# ---------------------------------------------------------------------
# 2. Install it.
# ---------------------------------------------------------------------
# nvm first where it is already installed: it is the only one of these
# that does not need root, and a beginner on WSL should not be asked for
# a sudo password to read a file.

install_with_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    step "Installing nvm"
    if have curl; then
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash \
        || return 1
    elif have wget; then
      wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash \
        || return 1
    else
      return 1
    fi
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" || return 1
  step "Installing Node ${MIN_MAJOR}+"
  nvm install "$MIN_MAJOR" >/dev/null 2>&1 || return 1
  nvm use "$MIN_MAJOR" >/dev/null 2>&1 || return 1
  return 0
}

install_with_brew() {
  have brew || return 1
  step "Installing Node ${MIN_MAJOR}+ with Homebrew"
  brew install node@22 >/dev/null 2>&1 || brew install node >/dev/null 2>&1 || return 1
  export PATH="$(brew --prefix)/opt/node@22/bin:$PATH"
  have node || export PATH="$(brew --prefix)/bin:$PATH"
  return 0
}

# apt, and only where apt exists. Needs sudo, so it says so before it
# asks — a prompt with no warning above it is how people get surprised.
install_with_apt() {
  have apt-get || return 1
  if [ "$(id -u)" -ne 0 ] && ! have sudo; then
    warn "Installing Node needs administrator rights and `sudo` is not installed."
    return 1
  fi
  SUDO=""
  [ "$(id -u)" -ne 0 ] && SUDO="sudo"

  step "Installing Node ${MIN_MAJOR}+ (this asks for your password once)"
  $SUDO apt-get update -qq || return 1
  $SUDO apt-get install -y -qq curl ca-certificates || return 1
  $SUDO install -d -m 0755 /etc/apt/keyrings || return 1
  if have curl; then
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | $SUDO gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg || return 1
  else
    return 1
  fi
  $SUDO sh -c 'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list' || return 1
  $SUDO apt-get update -qq || return 1
  $SUDO apt-get install -y -qq nodejs || return 1
  return 0
}

install_node() {
  # nvm wins if it is present — it needs no root.
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ] || have nvm; then
    install_with_nvm && return 0
    warn "nvm did not manage to install Node; trying another route."
  fi
  if have brew; then
    install_with_brew && return 0
    warn "Homebrew did not manage to install Node; trying another route."
  fi
  if have apt-get; then
    install_with_apt && return 0
    warn "apt did not manage to install Node."
  fi

  cat >&2 <<'GUIDANCE'
  I could not install Node for you automatically. Here is what to run by
  hand — pick the line that matches your machine:

    WSL, Debian or Ubuntu   sudo apt-get install -y nodejs npm
    macOS with Homebrew     brew install node
    Anything else           https://nodejs.org/en/download

  Then come back and run:

    npx --yes clirevenue setup
GUIDANCE
  return 1
}

# ---------------------------------------------------------------------
# 3. Run the CLI.
# ---------------------------------------------------------------------
# stdout on the way in, so a piped install script cannot swallow it and
# leave a beginner staring at a blank terminal wondering whether it worked.
if [ -t 1 ]; then
  exec 3>&1
else
  exec 3>&1 1>&2
fi

step "CLIRevenue setup"

if node_is_new_enough; then
  ok "Node $(node_major) found"
else
  if have node; then
    warn "Node $(node_major) is older than the ${MIN_MAJOR} this needs."
  else
    warn "Node is not installed."
  fi
  install_node || die "Could not install Node automatically."
  node_is_new_enough || die "Node still does not look right after installing."
  ok "Node $(node_major) installed"
fi

if [ "$#" -eq 0 ]; then
  set -- setup
fi

say ""
ok "Running: npx --yes clirevenue $*"
say ""
exec npx --yes clirevenue "$@" >&3