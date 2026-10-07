# 터미널 TUI

`tui/`는 Ginote의 터미널 버전이다. Go와 [Bubble Tea](https://github.com/charmbracelet/bubbletea) v2로
만들고, 웹 앱(`src/App.svelte`와 `src/lib`의 컴포넌트)의 화면 구성·동작·단축키를 옮긴다.
같은 GitHub 저장소를 노트로 쓰며, 저장 형식(첨부 링크·관리 블록·잠금 암호문)도 웹과 같다.

현재 터미널 안에서 직접 실행한다. Dock 앱과 Swift 실행기는 포함하지 않는다.

## 단일 바이너리로 실행

### Windows / PowerShell

64비트 Windows PowerShell 5.1 또는 PowerShell 7에서 다음 명령을 실행한다.
Windows용 릴리스 실행 파일을 설치하므로 WSL·Bash·Go·C 컴파일러·관리자 권한이 필요하지 않다.

```powershell
irm https://raw.githubusercontent.com/zidell/ginote/main/tui/install.ps1 | iex
ginote-tui
```

설치 위치는 `%LOCALAPPDATA%\Programs\ginote-tui\ginote-tui.exe`다. 설치 스크립트가 사용자
`PATH`와 현재 PowerShell의 `PATH`에 설치 폴더를 추가한다. 갱신할 때는 실행 중인 TUI를
종료하고 같은 설치 명령을 다시 실행한다. 다운로드의 SHA-256을 확인한 뒤 파일을 교체한다.
다운로드·검증 실패 시 기존 실행 파일을 보존한다([tui/install.ps1](../tui/install.ps1)).
Windows용 ZIP과 체크섬이 포함된 `tui-v...` 릴리스가 있어야 설치할 수 있다.

소스를 직접 빌드하는 개발자는 Go 1.27.1 이상과 MinGW 호환 `gcc`를 PATH에 준비하고 실행한다.
녹음을 포함해 빌드하며, 빌드 pepper는 macOS·Linux와 같은 환경 변수·`.env`에서 읽는다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tui\build-local.ps1
& "$env:LOCALAPPDATA\Programs\ginote-tui\ginote-tui.exe"
```

Windows Terminal에서 색상을 지원한다. `NO_COLOR` 또는 `TERM=dumb`이 설정되어 있으면 색상이
꺼진다. 투명도는 터미널의 외관 설정에서 조절한다. 파일 첨부는 경로 입력과 끌어놓기로 할 수
있으며 드라이브·UNC 경로와 따옴표로 감싼 공백 포함 경로를 받는다. macOS 전용 입력 소스
자동 전환·Quick Look·소스 변경 시 자동 재빌드는 Windows에서 사용하지 않는다.

### macOS / Linux

macOS·Linux에서는 다음 한 줄로 공개 저장소의 최신 소스를 내려받아 빌드·설치할 수 있다.
Go 1.27.1 이상과 C 컴파일러가 필요하다. 스크립트 내용은 [tui/install.sh](../tui/install.sh)에서 볼 수 있다.

```bash
curl -fsSL https://raw.githubusercontent.com/zidell/ginote/main/tui/install.sh | bash
```

설치 위치는 `~/.local/bin/ginote-tui`다. 셸이 `ginote-tui`를 찾지 못하면 `~/.local/bin`을
`PATH`에 추가한다. 한 줄 설치를 다시 실행하면 최신 `main` 소스로 갱신된다.

저장소를 직접 체크아웃해 개발할 때는 기존 빌드 스크립트를 사용한다.

```bash
cd tui
./build-local.sh       # ~/.local/bin/ginote-tui 빌드·설치
ginote-tui             # 이후 실행할 때는 이 명령만 사용
```

로컬 명령을 새 소스로 갱신하려면 관련 검사를 끝내고 `./build-local.sh`를 다시 실행한다.
빌드가 실패하면 이전 바이너리는 그대로 남고, 성공하면 새 바이너리로 한 번에 바뀐다.
실행에는 셸 스크립트가 필요하지 않다. 개발용 `dev.sh`의 자동 재빌드는 개발 세션의
`.dev/ginote-tui`만 갱신한다.
이미 실행 중인 TUI는 바이너리를 교체해도 이전 코드를 계속 쓴다. TUI 코드를 수정한 작업은
설치 후 사용 중인 세션에서 `Ctrl+R`로 제자리 재시작하고, 프로세스가 새 바이너리를 사용하는지
확인한다. 화면 상태는 재시작한 프로세스에 이어진다.

## 화면과 기능

| 웹 | TUI |
| --- | --- |
| 사이드바 머리줄: 저장소 전환(`` ` ``)·설정 | 같음. 다중 선택 중에는 태그·병합·삭제/복원·닫기 툴바 |
| 노트/휴지통 탭 | 같음(마우스, `[` `]`) |
| 검색(검색어·`#태그` 추천) | 같음(`/`로 이동, `#` 입력 시 태그 목록) |
| 새 노트·음성 녹음 버튼 | 같음(`N`, 🎤). 녹음은 마이크(miniaudio)로 받아 AAC로 줄여 OpenAI로 보낸다. 본문 E, 새 댓글 🎤, 댓글 메뉴에서도 녹음 |
| 목록 행(고정·잠금·마감일, 요약, `#번호 · 시각`, 태그), 더 보기 | 같음. 키보드 포커스는 주황 막대, 열린 노트는 회색 배경 |
| 노트 툴바: `#번호 \| 날짜`, 저장 상태, 태그 T, 첨부 A, ⋮ | 같음. ⋮ 메뉴: MD뷰어 M, 잠금 L, 상단고정 P, 음성 E, 치환 X, GitHub에서 보기 G, 삭제/복원, 생성·수정 시각 |
| 태그 칩(누르면 필터, ×로 제거, +태그) | 같음 |
| 본문 편집, 자동 저장, 첫 줄 제목/별도 제목 | 같음(실제 터미널 커서라 한글 조합 위치도 맞음). 드래그·Shift+방향키로 글을 선택하고, Ctrl+C 또는 터미널이 전달하는 Cmd+C로 복사한다. 선택한 채 입력하면 덮어쓴다. Fn+드래그는 Terminal 자체 선택 |
| 본문·댓글의 링크 | 밑줄로 보인다. 편집 중이 아닐 때 누르면 열고, 편집 중에는 Option을 누른 채 누른다. 이 노트의 첨부를 가리키면 훑어보기 창, 그 밖은 브라우저 |
| 첨부 목록(본문 위), 추가·삭제 | 같음. A는 macOS 파일 선택 창(여러 개 선택, 다른 OS는 경로 입력 창). Finder에서 노트 위로 끌어 놓아도 첨부된다(Terminal이 붙여 넣은 경로가 모두 실제 파일이면 첨부로 올림). Kitty 이미지 프로토콜 지원 터미널(Ghostty·iTerm2 등)에서는 실제 이미지 썸네일, 그 밖에는 반 칸 블록(▀) 모자이크를 보인다. 누르면 내려받아 macOS 훑어보기(Quick Look) 창으로 연다. 이미지는 노트의 다른 이미지도 함께 열려 창 안에서 ←/→로 넘긴다. 다른 창으로 옮기거나 터미널로 돌아오면 미리보기를 닫는다(macOS가 아니면 브라우저) |
| 댓글 목록·추가·편집·삭제 | 같음 |
| 잠금(6자리, 세션 기억) | 같음. 잠긴 동안 암호문을 그대로 보인다. 자체 배포 서버에서 잠근 노트는 환경설정의 잠금 pepper(`[preferences] lock_pepper`)를 그 서버의 `VITE_NOTE_LOCK_PEPPER`와 같게 둔다 |
| 다중 선택(Space, Shift+↑↓, Ctrl/Cmd·Shift 클릭), 태그 일괄 적용, 병합, 휴지통 | 같음 |
| 삭제 2초 유예와 Esc 취소 | 같음 |
| 환경설정: 저장소 관리, 태그 관리, 편집기 설정, 음성 녹음 | 같음(터미널이 정하는 글꼴·크기·줄간격·본문 너비는 없음). 웹은 바로 저장하지만 TUI는 확인을 눌러야 저장한다 |
| 사이드바 너비 조절 | 경계선을 끌어 바꾸고 `state.json`에 기억한다 |
| 도움말: 보안·MCP·설치·단축키 | 같음 |
| 붙여넣기로 새 노트 | 목록에서 붙여넣으면 그 내용으로 새 노트 |

본문 선택, 이슈 번호, MCP 안내 복사는 OS 클립보드에 직접 기록한다. 복사가 실패하면 성공 안내 대신
오류를 보여준다. 저장소를 바꾼 뒤에는 새 목록의 첫 노트에 키보드 포커스가 간다.

드롭다운 대신 모든 선택은 가운데 뜨는 모달 선택 창이다. 모달은 겹쳐 뜨고 아래를 어둡게 하며, Esc는 맨 위 모달만 닫는다. 모든 모달 아래에는 `[ 확인 ] [ 취소 ]` 같은 버튼 줄이 있고, Tab은 다음 칸이 아니라 버튼을 차례로 돌며 마지막 버튼 다음에는 원래 칸으로 돌아온다. 칸 사이는 ↑/↓로 옮긴다.

마우스로 모든 버튼·탭·행·메뉴를 누를 수 있고, 휠로 목록과 노트를 스크롤한다. 키보드 동작은
웹과 같다: ↑/↓로 목록 커서를 옮기고, Enter는 노트를 열되 목록 포커스를 유지하며, 한 번 더
Enter를 누르면 본문 편집으로 들어간다. 열린 노트에서 Tab은 오른쪽 편집기로 이동해 커서를 놓고,
Shift+Tab은 편집 내용을 저장하며 왼쪽 목록으로 돌아간다. Esc는 입력 끝내기 → 메뉴·선택 닫기 → 노트 닫기 순서로
한 단계씩 되돌린다. 웹과 달리 마우스 없이도 위쪽 도구에 닿도록, 첫 노트에서 ↑를 더 누르면
새 노트 버튼 → 검색칸 → 노트/휴지통 탭 → 맨 위 저장소 선택·설정 버튼으로 올라간다. 탭에서는 ←/→로
탭을 바꾸고 Enter로 지금 탭 목록을 새로 받으며, 맨 위 줄에서는 ←/→로 두 버튼을 오가며 Enter로 연다. ↓로 다시 내려온다.

R·Ctrl+R·Cmd+R은 웹의 새로고침(`location.reload`)처럼 전체 새로고침이다. 저장하지 않은 노트를
저장한 뒤 프로그램을 다시 시작해 설정 파일·토큰·목록을 처음부터 읽고, 보던 저장소·탭·검색어·
연 노트는 이어서 보인다(`internal/relaunch`). Cmd+R은 키를 앱에 넘겨주는 터미널(kitty 키보드
프로토콜을 쓰는 Ghostty 등)에서만 된다. macOS Terminal은 Cmd 키를 앱에 보내지 않는다.

### 한글 입력과 단일 키 단축키

기본값은 입력 소스를 유지한다. 입력기에서 한글 입력과 단축키가 함께 동작하도록 이미 설정한
경우 그대로 사용한다. 단일 키 단축키가 한글 조합 때문에 지연되는 macOS 환경에서는 환경설정의
"단축키를 쓸 때 영문 자판으로 바꾸기"를 켜서 입력 소스 자동 전환을 쓸 수 있다(`internal/ime`):

- 목록·메뉴·설정처럼 단축키를 쓰는 상태에서는 영문 자판으로 바꾼다. 쓰던 입력기에 영문 모드가
  있으면(구름의 `Gureum.system` 등) 그것을, 없으면 시스템 영문 자판(ABC 등)을 고른다.
- 본문·제목·댓글·검색·태그 입력·각종 입력 창에 들어가면 바꾸기 전 입력 소스로 되돌린다.
- 끝내거나 다시 시작할 때 원래 입력 소스로 돌려놓는다.
- 입력 소스 API는 메인 스레드에서 불러야 하므로 실제 전환은 이 바이너리를 짧게 다시 실행한
  하위 프로세스(`ginote-tui __ime ascii|select <ID>|current`)가 한다.
- 환경설정에서 자동 전환을 끄거나 `GINOTE_TUI_IME=off`로 비활성화할 수 있다.

입력 소스를 바꾸지 않는 환경(끈 경우, macOS가 아닌 경우)에서는, 터미널이 물리 키를 알려 주면
(kitty 키보드 프로토콜의 BaseCode) 자판 종류와 상관없이 그 키로 보고, 아니면 두벌식 자리로
바꿔 본다(`internal/ui/keys.go`).

## 개발 모드

```bash
cd tui
./dev.sh                        # 개발 모드: 소스 변경 시 자동 재빌드
./dev.sh --repo owner/name      # 저장소 하나를 바로 연다
```

`tui/dev.sh`는 `-tags dev`로 빌드해 띄운다. 앱이 `tui/` 아래 `.go`·`go.mod`·`go.sum`의 변경을
0.4초마다 확인하고, 바뀌면 직접 다시 빌드한 뒤 보던 화면(저장소, 탭, 검색어, 목록 커서, 연 노트,
스크롤, 도움말·설정)을 그대로 넘겨 새 바이너리로 제자리 재시작한다(`internal/devreload`,
`internal/relaunch`). 빌드가 실패하면 앱은 계속 쓸 수 있고 아래 줄에 첫 오류가 보이며, 고치면
다시 빌드한다.

- 재시작 때 찾은 GitHub 토큰은 환경 변수로만 넘긴다(파일에 쓰지 않음). 그래서 macOS 키체인
  확인 창은 처음 한 번만 뜬다.
- 화면 상태는 임시 파일로 넘기고 읽은 즉시 지운다. 비밀값은 넣지 않는다.
- 본문·댓글을 편집 중이거나 입력 창(저장소 추가·잠금 숫자 등)이 떠 있으면 재시작을 미루고,
  입력을 마치면 적용한다. 쓰던 내용과 토큰이 날아가지 않게 하기 위해서다.
- 릴리스 빌드(`-tags dev` 없음)에는 이 감시 코드가 들어가지 않는다.

`GINOTE_GITHUB_API_URL`을 주면 GitHub API 대신 그 주소로 요청한다(GitHub Enterprise나 가짜
서버로 화면을 시험할 때).

## 저장소와 토큰

저장소(워크스페이스)는 두 곳에서 모은다.

- **데스크톱 앱 저장소**: 앱의 `config.toml`([CONFIG](CONFIG.md))에서 읽기만 한다. 경로는
  `--config` 또는 `GINOTE_CONFIG`로 바꿀 수 있다.
- **TUI 저장소**: TUI 안에서 추가한다. 저장소가 없으면 시작할 때 추가 화면이 뜨고, 그 밖에는
  저장소 선택(`` ` ``)이나 환경설정의 "다른 저장소 추가"로 연다. 저장소 주소와 토큰을 받아
  GitHub에 연결해 본 뒤 저장한다. 이름 바꾸기·순서·연결 해제는 환경설정의 저장소 관리에서 한다.

TUI 설정 파일은 `os.UserConfigDir()/ginote-tui/config.toml`(macOS
`~/Library/Application Support/ginote-tui/config.toml`, `GINOTE_TUI_CONFIG`로 변경)이다. TUI
저장소, 마지막으로 연 저장소, TUI에서 바꾼 환경설정(`[preferences]`)을 둔다. 환경설정을 TUI에서
바꾼 적이 없으면 데스크톱 앱 `config.toml`의 값(`[display]`, `[behavior]`)을 쓴다.

TUI는 데스크톱 앱의 `config.toml`을 만들거나 고치지 않는다. 앱은 그 파일이 없을 때만 예전
`localStorage` 설정을 옮겨 오므로(`settings-backend.js`의 `init`), TUI가 먼저 만들면 앱의 기존
저장소와 PAT가 옮겨지지 않는다.

GitHub 토큰은 설정 파일에 쓰지 않는다. 찾는 순서(`internal/auth`):

1. `GINOTE_GITHUB_TOKEN`
2. 저장소의 PAT. 데스크톱 앱 저장소는 앱이 둔 `net.gitools.note` / `github-pat:<id>`,
   TUI 저장소는 추가할 때 넣은 `net.gitools.note.tui` / `github-pat:<id>`(OS 자격 증명 저장소)
3. `gh auth token`. 추가 화면에서 토큰을 비워 두면 이 방식으로 저장한다.

## 웹과 맞추는 규칙

옮겨 온 웹 코드와 대응은 다음과 같다. 원본을 고치면 같은 커밋에서 Go 쪽도 고치고, 테스트
기대값은 원본 JS 함수를 node로 실행한 값을 쓴다.

| Go | 웹 |
| --- | --- |
| `internal/notes/notes.go`, `text.go` | `notes.js`, `colors.js`, `pin-label.js` |
| `internal/notes/attachments.go` | `attachments.js` |
| `internal/notes/lock.go` | `note-lock.js` |
| `internal/notes/due.go`, `selection.go`, `labels.go`, `tagdef.go`, `deletion.go` | `due-date.js`, `issue-selection.js`, `issue-labels.js`, `tag-definition.js`, `deletion-queue.js` |
| `internal/merge` | `merge-notes.js` |
| `internal/github` | `github.js` |
| `internal/config` (`ParseRepo`, `PATCreationURL`, 환경설정) | `repo-address.js`, `settings-storage.js`, `app-config.js` |
| `internal/ui` | `App.svelte`, `NoteList*.svelte`, `NoteEditor.svelte`, `TagPicker.svelte`, `WorkspaceSwitcher.svelte`, `Selection*.svelte`, `DisplaySettings.svelte`, `WorkspaceList.svelte`, `TagSettings.svelte`, `HelpOverlay.svelte` |

- 첨부·잠금 형식([ATTACHMENTS](ATTACHMENTS.md), [ENCRYPTION](ENCRYPTION.md))은 이미 저장된 노트를
  다시 읽는 규약이다. 편집기에는 관리 블록을 숨기고 첨부 주소를 `{repo}/`로 줄여 보이며, 저장할 때
  웹과 같은 방식으로 되돌린다.
- 잠금 pepper는 웹과 같은 기본값을 쓰고, 빌드 때 `-ldflags "-X github.com/zidell/ginote/tui/internal/notes.AppPepper=..."`
  나 실행 때 `GINOTE_NOTE_LOCK_PEPPER`로 바꿀 수 있다.

## 검사

```bash
cd tui
gofmt -l .
go vet ./... && go vet -tags dev ./...
go test ./...
```

Windows에서는 PowerShell에서 `go vet ./...`, `go vet -tags dev ./...`, `go test ./...`를 실행한다.
설치 스크립트 검사는 저장소 루트에서 실행한다(실제 사용자 PATH·설정·자격 증명은 변경하지 않는다).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tui\install.test.ps1
```

`tui/` 변경을 `main`에 커밋하면 GitHub Actions가 macOS·Linux의 arm64·amd64, Windows의 amd64 바이너리를
검사·빌드해 [`tui-v...` 릴리스](https://github.com/zidell/ginote/releases)에 올린다. Tauri
데스크톱 앱의 자동 업데이트가 TUI 릴리스를 잘못 선택하지 않도록 GitHub에서 사전 릴리스로
표시한다. macOS·Linux의 한 줄 설치는 최신 `main` 소스를 직접 빌드하고, Windows의 한 줄
설치는 Windows ZIP·SHA-256 파일이 있는 최신 TUI 릴리스를 받는다.

`internal/ui`의 테스트는 가짜 GitHub 서버(`fake_test.go`)로 화면 흐름 전체를 검증한다: 목록·
열기·편집·자동 저장·관리 블록 보존, 새 노트, 삭제 유예와 취소, 복원, 고정, 검색·태그 필터,
태그 선택, 다중 선택 태그·병합, 댓글, 잠금, 치환, MD뷰어, 별도 제목, 저장소 추가·전환, 환경설정
저장, 마우스, 좁은 화면.
