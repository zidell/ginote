#!/usr/bin/env bash
# Launch production Ginote (or its TUI terminal) outside the agent's cgroup.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
systemctl --user show-environment >/dev/null
app=ginote
command=("$root/src-tauri/target/release/ginote")
if [[ "${1:-}" == --tui ]]; then
  shift
  app=ginote-tui
  binary="${GINOTE_TUI_BIN_DIR:-$HOME/.local/bin}/ginote-tui"
  if [[ ! -x "$binary" ]]; then echo "Build tui/build-local.sh first: $binary" >&2; exit 1; fi
  if command -v ghostty >/dev/null; then
    command=("$(command -v ghostty)" --class=net.gitools.note.tui --gtk-single-instance=false --title=Ginote -e "$binary")
  elif command -v konsole >/dev/null; then
    command=("$(command -v konsole)" --separate -e "$binary")
  else
    echo 'Ghostty or Konsole is required for an independent TUI window.' >&2
    exit 1
  fi
fi
if [[ ! -x "${command[0]}" ]]; then echo 'Build the desktop app first: npm run tauri:build -- --no-bundle' >&2; exit 1; fi
unit="$app-local-$(date +%s)-$$"
systemd-run --user --collect --quiet --unit="$unit" --service-type=exec \
  --property=ExitType=cgroup --working-directory="$root" -- "${command[@]}" "$@"
sleep 1
if ! systemctl --user is-active --quiet "$unit"; then
  echo "The launched app exited; inspect journalctl --user -u $unit (an existing Ginote instance may already own the window)." >&2
  exit 1
fi
echo "Ginote runs independently: $unit"
