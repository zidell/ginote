#!/bin/bash
# 맥 앱 E2E(디버그 빌드). 앱을 앞으로 가져와 실제 키·클릭 경로로 시험한다. 도는 동안 키보드·마우스를 쓰지 않는다.
#
#   macos/scripts/e2e.sh <항목,항목>    예) macos/scripts/e2e.sh paste,up   (항목 없이 부르면 전부)
#
# 필요한 것: GINOTE_TEST_REPO(버려도 되는 비공개 시험 저장소), gh 로그인, 터미널의 손쉬운 사용 권한.
# 결과: $OUT/e2e.log(PASS/FAIL), $OUT/shots/*.png(단계별 캡처), $OUT/trace.log(디버그 로그)
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/macos/build/Build/Products/Debug/Ginote Native.app/Contents/MacOS/Ginote"
OUT="${GINOTE_E2E_OUT:-${TMPDIR:-/tmp}/ginote-e2e}"
REPO="${GINOTE_TEST_REPO:?GINOTE_TEST_REPO=owner/시험저장소 를 지정하세요}"
KEYS="$OUT/keys.txt"
pkill -f "Ginote Native.app/Contents/MacOS/Ginote"; sleep 1
rm -rf "$OUT"; mkdir -p "$OUT/config" "$OUT/shots"
GINOTE_E2E_ONLY="${1:-}" GINOTE_E2E_KEYS="$KEYS" GINOTE_SELF_TEST=e2e GINOTE_SHOT_DIR="$OUT/shots" \
GINOTE_CONFIG_DIR="$OUT/config" GINOTE_TEST_REPO="$REPO" GINOTE_DEBUG_TOKEN="$(gh auth token)" \
GINOTE_SELF_TEST_LOG="$OUT/e2e.log" GINOTE_TRACE_LOG="$OUT/trace.log" "$APP" > "$OUT/stdout.txt" 2>&1 &
PID=$!
# 앱이 부탁하는 메뉴 단축키를 실제 키(시스템 이벤트)로 누른다. SwiftUI 메뉴 명령은 앱 안에서 만든 키에는 반응하지 않는다.
while kill -0 $PID 2>/dev/null; do
  if [ -f "$KEYS" ]; then
    IFS='|' read -r code mods < "$KEYS"
    using=""; [ -n "$mods" ] && using=" using {$mods}"
    osascript -e "tell application \"System Events\" to tell (first process whose name is \"Ginote\")
 set frontmost to true
 key code $code$using
end tell" >/dev/null 2>&1
    rm -f "$KEYS"
  fi
  sleep 0.2
done
wait $PID; status=$?
grep -E "^(FAIL|TIMEOUT|RESULT)" "$OUT/e2e.log"
exit $status
