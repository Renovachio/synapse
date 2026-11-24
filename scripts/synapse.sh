#!/bin/sh
# synapse setup script: the make targets call this. Asks where and from what when a person is there to answer.
#   sh scripts/synapse.sh help|setup|remove|status|check
# Presets, all optional: SCOPE=local|user  FROM=here|github  SYNAPSE_YES=1 (skip the remove confirmation)

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PLUGIN=synapse MARKETPLACE=synapse GITHUB=Renovachio/synapse
ID=$PLUGIN@$MARKETPLACE

if [ -t 1 ] && [ -z "$NO_COLOR" ]; then
  B=$(printf '\033[1m') D=$(printf '\033[2m') R=$(printf '\033[0m') G=$(printf '\033[32m')
  C=$(printf '\033[36m') Y=$(printf '\033[33m')
else B= D= R= G= C= Y=; fi

say()   { printf '%s\n' "$*"; }
done_() { say "${G}✔${R} $*"; }
miss()  { say "${D}○ $*${R}"; }
step()  { printf '\n%s▸%s %s%s%s\n' "$C" "$R" "$B" "$*" "$R"; }
die()   { say "$*" >&2; exit 1; }
interactive() { [ -n "$SYNAPSE_INTERACTIVE" ] || [ -t 0 ]; }
has_claude() { command -v claude >/dev/null 2>&1 || die 'claude (Claude Code) is not on PATH. Install it first.'; }
has_node() {
  command -v node >/dev/null 2>&1 || die 'node is not on PATH. synapse needs Node 22.5 or newer.'
  node -e "const[a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)" \
    || die "node $(node -v) is too old: synapse needs 22.5 or newer."
}

# ask_scope and ask_source: set SCOPE and FROM unless preset. Without a terminal they use the defaults.
ask_scope() {
  case $SCOPE in local|user) return;; esac
  SCOPE=local
  interactive || return 0
  say ''; say "${B}Where?${R}"
  say '  1) this project only   (default)'
  say '  2) every project'
  printf 'Choose [1-2]: '; read -r a
  [ "$a" = 2 ] && SCOPE=user
}
ask_source() {
  case $FROM in here|github) return;; esac
  FROM=github
  interactive || return 0
  say ''; say "${B}From where?${R}"
  say "  1) GitHub: $GITHUB (default)"
  say "  2) this clone: $ROOT"
  printf 'Choose [1-2]: '; read -r a
  [ "$a" = 2 ] && FROM=here
}
source_() { [ "$FROM" = here ] && say "$ROOT" || say "$GITHUB"; }

cmd_setup() {
  has_node; has_claude
  ask_scope; ask_source
  step "Adding the marketplace ($(source_))"
  if claude plugin marketplace add "$(source_)" >/dev/null 2>&1; then
    done_ "marketplace added"
  elif claude plugin marketplace update "$MARKETPLACE" >/dev/null 2>&1; then
    done_ "marketplace updated"
  else
    die "could not add the marketplace from $(source_)"
  fi
  step "Installing $ID at $SCOPE scope"
  claude plugin install "$ID" --scope "$SCOPE" >/dev/null 2>&1 || die "install failed; run: claude plugin install $ID --scope $SCOPE"
  done_ "$ID installed ($SCOPE)"
  say "Start a new Claude Code session so the hooks load."
}

cmd_remove() {
  has_claude; ask_scope
  if interactive && [ -z "$SYNAPSE_YES" ]; then
    printf 'Remove %s at %s scope? [y/N]: ' "$ID" "$SCOPE"; read -r a
    case $a in y|Y|yes) ;; *) say 'Nothing removed.'; return;; esac
  fi
  if claude plugin uninstall "$ID" --scope "$SCOPE" >/dev/null 2>&1; then done_ "$ID removed ($SCOPE)"; else miss "$ID not installed at $SCOPE scope"; fi
}

cmd_status() {
  has_claude
  if claude plugin list 2>/dev/null | grep -q "$ID"; then done_ "$ID is installed"; claude plugin details "$ID" 2>/dev/null | sed -n 1,3p
  else miss "$ID is not installed"; fi
}

cmd_check() {
  has_node
  step 'Tests'; (cd "$ROOT" && npm test --silent) || die 'tests failed'
  step 'Plugin manifest'; (cd "$ROOT" && claude plugin validate .) || die 'plugin validation failed'
  done_ 'checks passed'
}

case ${1:-help} in
  setup)  cmd_setup ;;
  remove) cmd_remove ;;
  status) cmd_status ;;
  check)  cmd_check ;;
  *) say 'usage: make setup | remove | status | check   (or: sh scripts/synapse.sh <command>)' ;;
esac
