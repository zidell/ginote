#!/bin/bash
# 시험 저장소에 연결한 앱을 띄우고 그대로 둔다(눈으로 확인용). 사용자 설정·키체인은 쓰지 않는다.
#
#   macos/scripts/ui.sh [노트 번호]
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/macos/build/Build/Products/Debug/Ginote Native.app/Contents/MacOS/Ginote"
OUT="${GINOTE_UI_OUT:-${TMPDIR:-/tmp}/ginote-ui}"
REPO="${GINOTE_TEST_REPO:?GINOTE_TEST_REPO=owner/시험저장소 를 지정하세요}"
# 이 스크립트가 띄웠던 시험 인스턴스만 끝낸다(쓰는 사람의 앱은 건드리지 않는다).
if [ -f "$OUT/pid" ] && ps -p "$(cat "$OUT/pid")" -o command= | grep -q "Ginote Native.app"; then kill "$(cat "$OUT/pid")"; sleep 1; fi
rm -rf "$OUT/config"; mkdir -p "$OUT/config"
GINOTE_SELF_TEST=ui GINOTE_UI_SELECT="${1:-}" GINOTE_CONFIG_DIR="$OUT/config" GINOTE_TEST_REPO="$REPO" \
GINOTE_DEBUG_TOKEN="$(gh auth token)" GINOTE_SELF_TEST_LOG="$OUT/ui.log" GINOTE_TRACE_LOG="$OUT/trace.log" \
"$APP" > "$OUT/stdout.txt" 2>&1 &
echo $! > "$OUT/pid"
