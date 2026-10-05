# Ginote Native (macOS 시험 앱)

웹 앱의 기능을 AppKit/SwiftUI로 옮긴 macOS 전용 앱이다. 제품의 중심은 Tauri 앱이고, 이 앱은 개발
Mac에서 직접 빌드해 써 보는 시험 프로젝트다. 릴리스·자동 업데이트는 없고 CI는 화면 없는 테스트만 돌린다. 설계와 웹과 공유하는
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

데이터 규약과 저장 상태를 확인하는 화면 없는 테스트만 기본 검사로 둔다. 변경에 닿는 테스트를 먼저 실행하고,
작업을 끝낼 때 전체 화면 없는 테스트를 각 한 번 실행한다. CI도 같은 두 명령을 사용한다.

```bash
(cd macos/Packages/GinoteCore && GINOTE_NODE="$(command -v node)" swift test)
(cd macos && xcodegen && xcodebuild -project GinoteNative.xcodeproj -scheme Ginote \
  -derivedDataPath build/test-derived -destination 'platform=macOS' test)
```

작업 중 모델 테스트 하나만 실행하려면 두 번째 명령에
`-only-testing:GinoteTests/NoteSessionTests/testEditBodySavesFirstLineTitle`처럼 이름을 붙인다.
테스트 빌드는 `build/test-derived`에 두어 사용 중인 디버그 앱을 덮어쓰지 않는다. GitHub와 OpenAI는
메모리 가짜 서버를 사용하며, 설정 폴더와 키체인 항목은 사용자 것과 분리한다. 웹 데이터 형식이 바뀌면
`node macos/scripts/make-fixtures.mjs`로 호환 fixture를 갱신한다. 웹 잠금 호환 검사는 Node.js 22 이상에서
실행한다.

### 실제 화면과 GitHub 검증

화면·키·포커스·메뉴를 바꾼 경우에는 시험 저장소로 **변경한 시나리오만** 실행한다. E2E는 앱을 앞으로
가져와 키보드·마우스를 쓰므로 사람이 쓰는 기기에서는 먼저 알린다. 실행기는 로그와 단계별 캡처를 남긴다.
실패하면 `e2e.log`의 FAIL/TIMEOUT, `trace.log`, `shots/`를 보고 해당 시나리오만 다시 실행한다.
기본 출력 폴더는 `${TMPDIR}/ginote-e2e`이고 `GINOTE_E2E_OUT`으로 바꿀 수 있다.
무인자 실행은 오류이며, 전체 실행은 공통 입력 경로나 여러 화면을 함께 바꾼 경우에만 `all`을 명시한다.

```bash
GINOTE_TEST_REPO=<owner/시험저장소> macos/scripts/e2e.sh paste,up
GINOTE_TEST_REPO=<owner/시험저장소> macos/scripts/e2e.sh all
```

시나리오: `list`, `up`, `new`, `comments`, `tags`, `toolbar`, `search`, `multi`, `lock`, `trash`,
`profile`, `paste`, `comment-undo`, `replace`, `tag-filter`, `trash-view`, `paging`.
실제 창을 눈으로 확인할 때는 `GINOTE_TEST_REPO=<owner/시험저장소> macos/scripts/ui.sh [노트 번호]`를 쓴다.
앱 변경이 GitHub 데이터를 쓰면 시험 저장소의 결과를 읽어 확인하고 되돌린다. 시험 인스턴스는 사용자 설정·
키체인을 쓰지 않는다. 디버그 로그는 기본적으로 `~/Library/Logs/Ginote Native/debug.log`에 남고,
시험 실행기는 별도 `trace.log`를 쓴다.

## 설정 파일

`~/Library/Application Support/net.gitools.note.mac/config.toml`. 키마다 주석이 달려 있고, 실행 중에
고쳐도 1초 안에 반영된다. 결과는 같은 폴더의 `config-status.txt`에 남는다. 위치는
`"Ginote Native.app/Contents/MacOS/Ginote" --config-path`로도 확인할 수 있다.
