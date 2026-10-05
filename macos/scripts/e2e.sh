#!/bin/bash
# 맥 앱 E2E(디버그 빌드). 앱을 앞으로 가져와 실제 키·클릭 경로로 시험한다. 도는 동안 키보드·마우스를 쓰지 않는다.
#
#   macos/scripts/e2e.sh <항목,항목|all>    예) macos/scripts/e2e.sh paste,up
#
# 필요한 것: GINOTE_TEST_REPO(버려도 되는 비공개 시험 저장소), gh 로그인, 터미널의 손쉬운 사용 권한.
# 결과: $OUT/e2e.log(PASS/FAIL), $OUT/shots/*.png(단계별 캡처), $OUT/trace.log(디버그 로그)
set -u
if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "사용법: macos/scripts/e2e.sh <항목,항목|all>" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="${GINOTE_E2E_APP:-$ROOT/macos/build/Build/Products/Debug/Ginote Native.app/Contents/MacOS/Ginote}"
OUT="${GINOTE_E2E_OUT:-${TMPDIR:-/tmp}/ginote-e2e}"
REPO="${GINOTE_TEST_REPO:?GINOTE_TEST_REPO=owner/시험저장소 를 지정하세요}"
KEYS="$OUT/keys.txt"
TOKEN="$(gh auth token)" || exit 1
if [ -z "$TOKEN" ]; then echo "GitHub 토큰을 읽지 못했습니다." >&2; exit 1; fi
if [ -f "$OUT/pid" ]; then
  previous_pid="$(cat "$OUT/pid")"
  if ps -p "$previous_pid" -o command= 2>/dev/null | grep -Fq "$APP"; then
    echo "이전 E2E 인스턴스가 실행 중입니다(PID $previous_pid). 종료 후 다시 실행하세요." >&2
    exit 1
  fi
fi
rm -rf "$OUT"; mkdir -p "$OUT/config" "$OUT/shots"
GINOTE_E2E_ONLY="$1" GINOTE_E2E_KEYS="$KEYS" GINOTE_SELF_TEST=e2e GINOTE_SHOT_DIR="$OUT/shots" \
GINOTE_CONFIG_DIR="$OUT/config" GINOTE_TEST_REPO="$REPO" GINOTE_DEBUG_TOKEN="$TOKEN" \
GINOTE_SELF_TEST_LOG="$OUT/e2e.log" GINOTE_TRACE_LOG="$OUT/trace.log" "$APP" > "$OUT/stdout.txt" 2>&1 &
PID=$!
echo "$PID" > "$OUT/pid"
# 앱이 부탁하는 메뉴 단축키를 실제 키(시스템 이벤트)로 누른다. SwiftUI 메뉴 명령은 앱 안에서 만든 키에는 반응하지 않는다.
while kill -0 $PID 2>/dev/null; do
  if [ -f "$KEYS" ]; then
    IFS='|' read -r code mods < "$KEYS"
    using=""; [ -n "$mods" ] && using=" using {$mods}"
    osascript -e "tell application \"System Events\" to tell (first process whose unix id is $PID)
 set frontmost to true
 key code $code$using
end tell" >/dev/null 2>&1
    rm -f "$KEYS"
  fi
  sleep 0.2
done
wait $PID; status=$?
grep -E "^(FAIL|TIMEOUT|RESULT)" "$OUT/e2e.log"
echo "로그와 캡처: $OUT"
exit $status
