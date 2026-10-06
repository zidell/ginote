#!/usr/bin/env bash
# TUI 개발 모드. 개발용(-tags dev)으로 빌드해 띄우고, tui/ 아래 Go 소스가 바뀌면 앱이 스스로 다시
# 빌드해 지금 보던 화면 그대로 새 바이너리로 바뀐다. 빌드가 실패하면 앱은 그대로 두고 아래 줄에
# 오류만 보인다.
#
# 현재 터미널에서 실행한다(예: ./dev.sh --repo owner/name).
set -euo pipefail

cd "$(dirname "$0")"
# 잠금 pepper는 웹 빌드와 같은 값을 넣는다(scripts/pepper.sh). 앱이 스스로 다시 빌드할 때는 지금 값을 이어 쓴다.
LDFLAGS="$(bash scripts/pepper.sh)"

mkdir -p .dev
go build -tags dev -ldflags "$LDFLAGS" -o .dev/ginote-tui ./cmd/ginote-tui
export GINOTE_TUI_DEV_SRC="$PWD"
exec .dev/ginote-tui "$@"
