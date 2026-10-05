# Ginote Native (macOS 시험 앱)

웹 앱의 기능을 AppKit/SwiftUI로 옮긴 macOS 전용 앱이다. 제품의 중심은 Tauri 앱이고, 이 앱은 개발
Mac에서 직접 빌드해 써 보는 시험 프로젝트다. 릴리스·자동 업데이트·CI는 없다. 설계와 웹과 공유하는
데이터 규약은 [DESIGN.md](DESIGN.md)에 있다.

## 빌드와 실행

```bash
brew install xcodegen          # 처음 한 번
cd macos
xcodegen                       # project.yml → GinoteNative.xcodeproj (커밋하지 않음)
xcodebuild -project GinoteNative.xcodeproj -scheme Ginote -configuration Release \
  -derivedDataPath build -destination 'platform=macOS' build
open "build/Build/Products/Release/Ginote Native.app"
```

Xcode에서 `GinoteNative.xcodeproj`를 열어 실행해도 된다. 기본 서명은 로컬 실행용(`-`)이다.
이 서명은 빌드할 때마다 앱 식별값이 바뀌어, 다시 빌드하면 macOS가 키체인 접근 허용을 또 묻는다
("항상 허용"도 그 빌드에만 걸린다). 인증서가 있으면 `macos/Signing.local.xcconfig`(커밋하지 않음)에
서명을 적어 둔다. Xcode·`xcodebuild` 모두 이 파일을 읽으므로 이후 빌드는 늘 같은 서명이 된다.

```
CODE_SIGN_IDENTITY = Developer ID Application
DEVELOPMENT_TEAM = <팀 ID>
```
`/Applications`에 두고 쓰려면 빌드한 `Ginote Native.app`을 복사한다.

- 앱 이름은 `Ginote Native`, 번들 ID는 `net.gitools.note.mac`이다. Tauri 앱(`Ginote.app`)과 함께
  설치해도 설정·자격 증명이 섞이지 않는다.
- 처음 실행할 때 Tauri 앱 설정(`~/Library/Application Support/net.gitools.note/config.toml`)에
  저장소가 있으면 가져오고, 그 PAT·OpenAI 키를 이 앱의 키체인 항목으로 복사한다. 이때 macOS가 키체인
  접근 허용을 한 번 물을 수 있다.

## 앱 아이콘

`Ginote/Resources/Assets.xcassets/AppIcon.appiconset`은 `node macos/scripts/app-icon.mjs`로 만든다.
원본은 Tauri와 같은 `src-tauri/icons/source/`의 SVG 두 장이고, macOS 아이콘 규격(1024 캔버스에 824
둥근판, 둘레 여백과 옅은 그림자)에 맞춰 그린다. 원본을 고쳤으면 이 스크립트도 다시 돌린다.

## 잠금 pepper

빌드 단계가 `scripts/lock-pepper.sh`로 `Ginote/Generated/LockPepper.swift`를 만든다(커밋하지 않음).
값은 웹(Vite 프로덕션 빌드)과 같은 순서로 찾는다: 빌드 환경변수 `VITE_NOTE_LOCK_PEPPER` → 저장소
루트의 `.env.production.local` → `.env.production` → `.env.local` → `.env`. 없으면 소스의 기본값
(`NoteLock.defaultPepper`, 웹 `DEFAULT_APP_PEPPER`와 같은 값)을 쓴다. 빌드 기록에는 값의 출처와
길이만 남는다.

## 검사

```bash
cd macos/Packages/GinoteCore && swift test
cd macos && xcodegen && xcodebuild -project GinoteNative.xcodeproj -scheme Ginote -derivedDataPath build \
  -destination 'platform=macOS' test
```

`xcodebuild test`는 화면 모델(`WorkspaceModel` 등)을 가짜 GitHub(`GinoteTests/FakeGitHub.swift`, 메모리 저장소)로
검사한다. 앱을 호스트로 띄우지만 단위 테스트일 때는 창·Dock·포커스를 쓰지 않고(`AppModel.isUnitTest`), 사용자 설정과
키체인도 건드리지 않는다. 몇 초면 끝나므로 작업 중에 뒤에서 돌려도 된다. CI(`.github/workflows/macos-native.yml`)도
같은 테스트를 돌린다.

- 목록·개수·저장·병합처럼 모델이 정하는 동작은 여기에 테스트를 더한다. `FakeGitHub.freezeCounts()`는 쓰기 직후
  GitHub 개수가 늦게 따라오는 상황을 만든다.
- 줄 순서처럼 화면이 따르는 규칙은 모델에 두고(예: `WorkspaceModel.listRowIds`) 화면과 테스트가 같은 값을 쓰게 한다.
- 툴바 배치, 스크롤, 포커스, 입력기처럼 실제 창에서만 드러나는 것은 화면 밖 창에서 재현되지 않는다(2026-10-05:
  사이드바 접기 뒤 스크롤 밀림이 화면 밖 창에서는 재현되지 않음을 대조 테스트로 확인). 아래 "화면을 바꿨을 때 눌러 볼 것"으로
  확인한다.

웹 코드(`src/lib`)가 만든 기대값과 Swift 결과를 비교한다. 잠금은 양방향(웹 암호문을 Swift가,
Swift 암호문을 웹이)으로 풀어 본다. Node가 있으면 기대값이 지금 웹 코드와 맞는지도 확인한다.
웹의 규약 코드를 바꿨으면 기대값을 다시 만든다.

```bash
node macos/scripts/make-fixtures.mjs
```

이 명령은 음성 정제 프롬프트·프리셋(`VoicePresets.generated.swift`)도 웹 코드에서 다시 만든다.

### 실제 GitHub 저장소로 자가 점검 (디버그 빌드 전용)

디버그 빌드에는 `Ginote/Debug/SelfTest.swift`가 들어 있다. 실제 화면 모델로 시험 저장소에 노트 작업을
보내고 GitHub API로 결과를 다시 읽어 확인한다. 다루는 범위는 다음과 같다.

- 새 노트, 자동 저장, 한글 조합, 태그, 고정
- 빈 저장소의 첨부 브랜치, 첨부 올리기·본문삽입·삭제
- 댓글과 댓글 첨부
- 잠금(웹 코드로 복호화 확인), 다른 기기에서 휴지통으로 간 노트 저장
- 휴지통·실행 취소, 검색, 초안 복구, 음성 전달, 병합, 태그 이름 변경, 설정 파일 감시

사용자 설정·키체인은 쓰지 않는다. 릴리스 빌드에는 들어가지 않는다.

```bash
GINOTE_SELF_TEST=1 GINOTE_CONFIG_DIR="$(mktemp -d)" GINOTE_TEST_REPO=<owner/버리는-비공개-저장소> \
GINOTE_DEBUG_TOKEN="$(gh auth token)" GINOTE_SELF_TEST_LOG=/tmp/ginote-selftest.log \
GINOTE_VERIFY_LOCK="$PWD/macos/scripts/verify-lock.mjs" GINOTE_NODE="$(command -v node)" \
"macos/build/Build/Products/Debug/Ginote Native.app/Contents/MacOS/Ginote"
```

### 화면 확인

`macos/scripts/ui.sh [노트 번호]`는 시험 저장소에 연결한 앱을 띄우고 그대로 둔다(`GINOTE_SELF_TEST=ui`).
`GINOTE_UI_IME=1`을 더하면 편집기에 한글 조합 입력을 흉내 내 넣고 저장까지 확인한다.

`GINOTE_SELF_TEST=tour GINOTE_SHOT_DIR=<폴더>`는 로딩·노트 열기·미리보기·휴지통·라이트 테마·확대·설정·도움말
화면을 차례로 PNG로 남기고 끝난다(`Ginote/Debug/SceneTour.swift`). 창 캡처라 시트·팝오버는 찍히지 않는다.

### E2E (키보드·메뉴·포커스)

`Ginote/Debug/E2E.swift`가 앱을 앞으로 가져와 실제 이벤트 경로로 키와 클릭을 보내고, 화면 모델·첫 응답자·
GitHub 결과로 확인한다. 항목마다 단계별 캡처를 남긴다.

```bash
GINOTE_TEST_REPO=<owner/시험저장소> macos/scripts/e2e.sh paste,up   # 항목만 골라 실행
```

항목 이름: `list`(목록 키보드) `up`(맨 위 ↑ 사슬) `new`(⌘N) `comments` `tags` `toolbar`(고정·미리보기·찾기·확대)
`search` `multi` `lock` `trash` `profile` `paste` `comment-undo` `replace` `tag-filter` `trash-view` `paging`.
`new`를 빼면 시험 노트를 API로 만들어 쓴다.

지켜야 할 것:

- **실패한 항목만 돌린다.** 전체는 몇 분 동안 화면을 붙잡는다. 고친 항목만 이름으로 다시 돌린다.
- **도는 동안 앱이 앞으로 나와 키보드·마우스를 쓴다.** 사람이 쓰는 기기라면 먼저 묻고, 그동안 입력하지 않게 한다.
  다른 데서 친 키가 시험 노트에 들어간다.
- 메뉴 단축키(⌘N, ⇧⌘M 등)는 앱 안에서 만든 키 이벤트에 반응하지 않는다. 시험이 요청 파일로 부탁하면
  `e2e.sh`가 시스템 이벤트로 실제 키를 누른다. 터미널에 손쉬운 사용 권한이 필요하다.
- 글자는 입력기를 거치지 않게 첫 응답자에 직접 넣는다. `osascript`의 `keystroke`·`key code`로 글자를 치면
  한글 입력기가 바꿔 버린다(예: `x`→`ㅌ`). 단축키에는 `key code`를 쓴다(`keystroke "="`는 ⌘=로 가지 않는다).
- 시험 노트는 끝날 때 휴지통으로 옮긴다. 중간에 끊으면 `E2E 노트` 제목의 노트가 남으니 닫아 둔다.

### 화면을 바꿨을 때 눌러 볼 것

화면·동작을 고쳤으면 고친 곳만 보지 말고 아래를 시험 인스턴스(`GINOTE_SELF_TEST=ui`)에서 실제로 눌러 화면을 찍어 본다.
고친 곳 옆에서 다른 것이 깨지는 일이 반복됐다(2026-10-05: 미리보기 툴바 배치, 사이드바 접기 뒤 태그 줄 사라짐, ⌘F 무반응,
휴지통 뒤 개수, 메뉴에서 빠진 "지금 저장"). 데이터가 바뀌는 동작은 GitHub에서도 확인하고 원래대로 되돌린다.

- 메뉴바: 파일(새 노트·음성으로 새 노트·새 창에서 열기·지금 저장), 편집(찾기·다음/이전 찾기·선택 항목으로 찾기·노트 검색·
  찾아 바꾸기), 보기(확대·축소·실제 크기·Markdown 미리보기 켜기/끄기·새로고침), 노트 메뉴 전 항목, 저장소(전환·추가), 도움말
- 노트 툴바 버튼 전부와 "더 보기" 메뉴. 미리보기를 켠 상태·끈 상태·노트를 고르지 않은 상태에서 버튼 자리가 같은지
- 사이드바: 저장소 전환, 노트·휴지통·태그 전환, 같은 항목 다시 누르기(새로고침), 사이드바 접기·펴기(편집·미리보기 둘 다)
- 목록: 클릭·⌘클릭·⇧클릭, 우클릭 메뉴, 맨 위에서 ↑(검색칸), 새 노트가 고정 노트 아래에 생기는지
- 설정: 탭 6개, 단축키 칸에 새 조합 넣기·겹치는 조합·되돌리기(메뉴에 반영되는지), 저장소 탭의 태그 추가·삭제
- 휴지통 이동 → 실행 취소: 목록 머리·사이드바 개수

메뉴는 `System Events`의 `click menu item`으로, 목록·사이드바 클릭은 실제 마우스 이벤트(CGEvent)로 보낸다
(`System Events`의 `click at`은 SwiftUI 목록에 전달되지 않는다). 창은 `screencapture -l <창 번호>`로 찍는다.

- 시험 인스턴스(`GINOTE_SELF_TEST`, `GINOTE_CONFIG_DIR`)는 Tauri 설정을 가져오지 않고, 화면 점검 모드(`ui`)는
  키체인을 읽지 않는다. 사람이 쓰는 화면에 키체인 허용 창이 뜨지 않게 하려는 것이다.
- 시험 중 만든 노트는 끝나면 휴지통으로 옮긴다(`gh issue close <번호> -R <owner/시험저장소>`). 고정·태그처럼 바꾼 것도
  원래대로 되돌린다.
- 시험 인스턴스는 띄운 PID로 끈다. 환경변수는 명령줄에 나오지 않아 `pkill -f <설정 폴더>`로는 찾지 못하고,
  남은 인스턴스가 화면에 쌓인다.
- 입력기에 따라 결과가 달라지는 입력(잠금 숫자 등)은 한글 입력기, 특히 숫자 줄에 한글이 있는 세벌식을 켠 채
  시험한다. 입력기 전환은 Carbon `TISSelectInputSource`로 한다.

### 디버그 로그

디버그 빌드는 화면 상태 변화(키, 칸 포커스, 선택·열기, 목록 읽기 등)를 늘 남긴다. 기본 위치는
`~/Library/Logs/Ginote Native/debug.log`이고 5MB를 넘으면 `debug.1.log`로 넘긴다. `GINOTE_TRACE_LOG`로
다른 파일을 지정할 수 있다. 릴리스 빌드는 남기지 않는다.

## 설정 파일

`~/Library/Application Support/net.gitools.note.mac/config.toml`. 키마다 주석이 달려 있고, 실행 중에
고쳐도 1초 안에 반영된다. 결과는 같은 폴더의 `config-status.txt`에 남는다. 위치는
`"Ginote Native.app/Contents/MacOS/Ginote" --config-path`로도 확인할 수 있다.
