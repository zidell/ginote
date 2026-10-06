#!/usr/bin/env bash
# 공개 GitHub 소스에서 Ginote TUI를 빌드해 ~/.local/bin에 설치한다.
set -euo pipefail

for tool in curl tar go cc; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Ginote TUI 설치에 %s 명령이 필요합니다. Go 1.27.1 이상과 C 컴파일러를 설치해 주세요.\n' "$tool" >&2
    exit 1
  fi
done

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) printf 'Ginote TUI 한 줄 설치는 macOS와 Linux에서 지원합니다.\n' >&2; exit 1 ;;
esac

installer_dir="$(mktemp -d "${TMPDIR:-/tmp}/ginote-tui-install.XXXXXX")"
trap 'rm -rf -- "$installer_dir"' EXIT
archive_url="${GINOTE_TUI_ARCHIVE_URL:-https://github.com/zidell/ginote/archive/refs/heads/main.tar.gz}"

printf 'Ginote TUI 소스를 내려받는 중…\n'
curl -fsSL --retry 3 "$archive_url" -o "$installer_dir/ginote.tar.gz"
tar -xzf "$installer_dir/ginote.tar.gz" -C "$installer_dir"

if [[ ! -f "$installer_dir/ginote-main/tui/build-local.sh" ]]; then
  printf '내려받은 파일에 Ginote TUI 빌드 스크립트가 없습니다.\n' >&2
  exit 1
fi

bash "$installer_dir/ginote-main/tui/build-local.sh"
printf '터미널에서 ginote-tui를 실행하세요. 명령을 찾지 못하면 ~/.local/bin을 PATH에 추가하세요.\n'
