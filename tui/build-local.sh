#!/usr/bin/env bash
# 터미널에서 쓰는 단일 바이너리를 빌드해 ~/.local/bin에 원자적으로 설치한다.
set -euo pipefail

cd "$(dirname "$0")"
bin_dir="${GINOTE_TUI_BIN_DIR:-$HOME/.local/bin}"
target="$bin_dir/ginote-tui"
mkdir -p "$bin_dir"
temporary="$(mktemp "$bin_dir/.ginote-tui.XXXXXX")"
trap 'if [[ -e "$temporary" ]]; then unlink "$temporary"; fi' EXIT

go build -ldflags "$(bash scripts/pepper.sh)" -o "$temporary" ./cmd/ginote-tui
chmod 755 "$temporary"
mv -f "$temporary" "$target"
trap - EXIT
printf '설치: %s\n' "$target"
