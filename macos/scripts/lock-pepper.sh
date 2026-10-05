#!/bin/bash
# 잠금 pepper를 빌드에 넣는다(macos/DESIGN.md §7). Xcode 빌드 단계가 부른다.
#
# 찾는 순서는 웹(Vite 프로덕션 빌드)과 같다: 빌드 환경변수 VITE_NOTE_LOCK_PEPPER →
# 저장소 루트의 .env.production.local → .env.production → .env.local → .env.
# 어디에도 없으면 빈 값을 쓰고, 앱은 소스의 기본 pepper(NoteLock.defaultPepper)를 쓴다.
# 값은 출력하지 않는다. 생성 파일은 커밋하지 않는다(.gitignore).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
output="${1:-$here/../Ginote/Generated/LockPepper.swift}"
key="VITE_NOTE_LOCK_PEPPER"

read_dotenv() {
  local file="$1"
  [ -f "$file" ] || return 1
  local line
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$file" | tail -n 1 || true)"
  [ -n "$line" ] || return 1
  local value="${line#*=}"
  value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
    *) value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//')" ;;
  esac
  printf '%s' "$value"
}

pepper="${VITE_NOTE_LOCK_PEPPER:-}"
source="build environment"
if [ -z "$pepper" ]; then
  source="source default"
  for name in .env.production.local .env.production .env.local .env; do
    if value="$(read_dotenv "$repo_root/$name")" && [ -n "$value" ]; then
      pepper="$value"
      source="$name"
      break
    fi
  done
fi

encoded="$(printf '%s' "$pepper" | base64 | tr -d '\n')"
mkdir -p "$(dirname "$output")"
content="// 빌드 때 macos/scripts/lock-pepper.sh가 만든다. 커밋하지 않는다.
// 잠금 pepper(Base64). 비어 있으면 NoteLock.defaultPepper를 쓴다.
enum BuildLockPepper {
    static let base64 = \"$encoded\"
}
"
if [ ! -f "$output" ] || [ "$(cat "$output")" != "$(printf '%s' "$content")" ]; then
  printf '%s' "$content" > "$output"
fi
echo "lock pepper: ${source} (length ${#pepper})"
