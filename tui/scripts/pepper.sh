#!/usr/bin/env bash
# TUI 빌드에 넣을 잠금 pepper의 -ldflags를 출력한다. 웹 빌드와 같은 값을 쓴다:
# 환경변수 VITE_NOTE_LOCK_PEPPER, 없으면 저장소 루트 .env의 VITE_NOTE_LOCK_PEPPER. 둘 다 없으면 아무것도
# 출력하지 않아 소스 기본값을 쓴다(docs/ENCRYPTION.md). 값은 화면에 따로 찍지 않는다.
root="$(cd "$(dirname "$0")/../.." && pwd)"
pepper="${VITE_NOTE_LOCK_PEPPER:-}"
if [ -z "$pepper" ] && [ -f "$root/.env" ]; then
  pepper="$(sed -n 's/^VITE_NOTE_LOCK_PEPPER=//p' "$root/.env" | tail -n 1 | tr -d "\"'[:space:]")"
fi
if [ -n "$pepper" ]; then
  printf '%s' "-X github.com/zidell/ginote/tui/internal/notes.AppPepper=$pepper"
fi
