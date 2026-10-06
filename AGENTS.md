# Ginote 개발 안내

Ginote를 개발·검증·배포하는 규칙과 절차를 모은 시작 문서다. 사람과 코딩 에이전트가 함께
읽는다. 사용자 안내는 `README.md`, 기능·데이터 형식·배포 흐름의 세부는 `docs/`의 주제별
문서에 있다. 이 파일에는 규칙과 문서 위치만 두고, 설명은 해당 문서에 둔다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [docs/APP_OTA.md](docs/APP_OTA.md) | 설치된 앱의 웹 빌드 교체: 매니페스트, 서명 키, 네이티브 호환성 |
| [docs/DESKTOP.md](docs/DESKTOP.md) | 데스크톱 앱: 로컬 빌드, 앱 업데이트, 릴리스, 서명, Windows 설치 프로그램 |
| [docs/MOBILE.md](docs/MOBILE.md) | Android·iOS: 로컬 빌드, 직접 고친 네이티브 부분, 아이콘 |
| [docs/TUI.md](docs/TUI.md) | 터미널 TUI: 실행, 기능, 설정, 검사 |
| [docs/CONFIG.md](docs/CONFIG.md) | 설치형 앱의 설정 파일(`config.toml`)과 자격 증명 저장소 |
| [docs/ATTACHMENTS.md](docs/ATTACHMENTS.md) | 첨부파일 저장 규약, 권한, 보관, 호환성 |
| [docs/ENCRYPTION.md](docs/ENCRYPTION.md) | 노트 잠금의 암호화 형식, 보호 경계, 배포 pepper |
| [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md) | 플랫폼별 서명과 개인정보 처리 범위 |
| [docs/screencasting.md](docs/screencasting.md) | README 미리보기 GIF 생성 |
| [macos/DESIGN.md](macos/DESIGN.md) | macOS 네이티브(Swift) 시험 앱 설계(로컬 빌드 전용): 웹과 공유하는 데이터 규약, 화면, pepper |

맥 네이티브 앱(`macos/`)을 고칠 때의 빌드·시험 방법은 [macos/README.md](macos/README.md)에 있다. E2E는
앱을 앞으로 가져와 키보드·마우스를 쓰므로, 사람이 쓰는 기기에서는 먼저 묻고 실패한 항목만 이름으로 다시
돌린다(전체를 되풀이하지 않는다).

TUI 코드를 고치면 [docs/TUI.md](docs/TUI.md)의 검사와 로컬 바이너리 갱신을 마친 뒤, 실행 중인
TUI 세션도 `Ctrl+R`로 재시작한다. 재시작한 프로세스가 새 바이너리를 사용 중인지 확인하고
나서 반영됐다고 보고한다. 바이너리만 교체하고 기존 세션을 그대로 두지 않는다.

저장소 루트에 `AGENTS.local.md`가 있으면 작업 전에 먼저 읽는다. 개발자 개인에 관한 것(개인 시험 저장소
이름, 키·인증서 위치와 이름, 그 기기의 설치 상태·입력기·기기 버전)만 담는 파일이며 커밋하지 않는다(`.gitignore`).
개발·시험 절차와 규칙은 포크해서 이어 개발할 사람도 필요하므로 이 파일이 아니라 레포 문서에 적는다.

## 개발 환경

CI는 Node.js 22와 `npm ci`를 쓴다. 의존성을 바꾸면 `package.json`과 `package-lock.json`을
함께 커밋한다. 네이티브 앱은 Rust와 [Tauri 사전 요구 사항](https://v2.tauri.app/start/prerequisites/)이
필요하다.

```bash
npm ci              # 잠금 파일 기준 설치
npm run dev         # 웹 개발 서버
npm run tauri:dev   # 데스크톱 앱 개발 모드
npm run check       # Svelte 정적 검사
npm test            # Vitest 전체 테스트
npm run build       # 프로덕션 웹 빌드
npm run icons       # 앱·웹 아이콘 전체 생성
```

웹·Tauri 코드를 바꿨으면 작업 끝에 다음 검사를 한 번 통과시킨다. Swift 전용 변경은
[macos/README.md](macos/README.md)의 검사 절차를 따른다. 웹 CI는 `main` push와 pull request에서
같은 검사를 하고, 웹 커버리지(`npm run test:coverage`)를 Codecov에 올린다.

```bash
npm run check
npm test
npm run build
(cd src-tauri && cargo test --lib)
```

테스트는 필요한 것만 돌린다. 고친 코드에 닿는 테스트와 직전에 실패한 테스트만 이름으로 돌리고, 전체 실행은 작업 끝에
한 번만 한다. 그 뒤 한두 개를 고쳤으면 그 테스트만 다시 돌리고 전체를 또 돌리지 않는다. 화면을 쓰는 테스트(E2E·화면 UI
테스트)는 특히 그렇다. 도는 동안 사람이 기기를 못 쓴다.

화면·동작을 바꿨으면 검사 통과로 끝내지 않고 직접 실행해 확인한다.

- 사용자에게 "확인해 보세요"라고 넘기지 않는다. 앱을 띄워 고친 곳과 그 주변(같은 화면의 다른 버튼, 상태 전환,
  사이드바 접기·창 크기 같은 배치 변화)을 실제로 누르고 화면을 찍어 본다. 데이터가 바뀌는 동작은 GitHub에서
  결과를 확인하고 되돌린다. 직접 확인하지 못한 부분은 이유와 함께 밝힌다.
- 맥 네이티브 앱은 고친 코드에 닿는 Core·모델 단위 테스트와 해당 E2E 시나리오만 실행한다
  ([macos/README.md](macos/README.md)의 "검사"). 전체 화면 없는 테스트는 작업 끝에 한 번,
  전체 E2E는 공통 경로나 여러 화면을 함께 바꿨을 때만 명시적으로 실행한다.
  화면을 쓰는 시험은 사람이 쓰는 기기에서는 미리 알리고 한다.
- 사용자가 쓰고 있는 앱을 다시 빌드했으면 그 앱을 직접 다시 띄운다. "다시 실행해야 반영된다"고 안내만 하지
  않는다. 맥 네이티브 디버그 앱은 `osascript -e 'tell application id "net.gitools.note.mac" to quit'`로 끝나기
  (쓰던 노트를 저장한다)를 기다린 뒤 `open "macos/build/Build/Products/Debug/Ginote Native.app"`로 열고, 새 프로세스의
  시작 시각이 빌드 시각보다 늦은지 확인한다. 데스크톱(Tauri) 앱은 [DESKTOP](docs/DESKTOP.md)의 "로컬 빌드를 설치해
  쓰기"대로 설치한 뒤 다시 연다.
- 시험 인스턴스에서 확인한 것과 사용자가 쓰는 앱에 반영된 것은 다르다. 둘 다 끝나야 "고쳤다"고 보고한다.
- 시험 인스턴스는 시험용 설정·키체인·저장소를 쓰므로 사용자 앱의 실제 상태를 보여 주지 않는다. 서명·설정·키체인·
  설치를 건드렸으면 사용자 앱의 상태도 읽기만 해서 확인한다: 설정 파일이 읽혔는지(`config-status.txt`), 저장소마다
  토큰이 있는지, 음성을 쓰는 사용자라면 OpenAI 키가 있는지, 설치된 앱이 저장소에 연결된 화면으로 뜨는지.

## 코드 구조

- `src/App.svelte`: 화면 전체의 상태(워크스페이스, 노트 목록, 선택, 라우트)를 들고 하위
  컴포넌트와 모듈을 잇는 조립 지점. 새 기능의 계산 로직이나 독립된 UI는 여기에 넣지 않고
  아래 위치로 분리한다.
- `src/lib/*.svelte`: 화면 조각. 목록(`NoteList`), 검색(`SidebarSearch`), 다중 선택
  (`SelectionToolbar`, `SelectionTagPanel`), 환경설정(`DisplaySettings`, `VoiceSettings`,
  `AppUpdateSettings`), 공용 시트(`SheetView`), 도움말(`HelpOverlay`), 저장소 추가
  (`AddWorkspaceDialog`), 편집기(`NoteEditor`) 등.
- `src/lib/*.js`: 화면과 무관한 로직.
  - GitHub API: `github.js`
  - 순수 계산: `app-routes.js`, `issue-labels.js`, `issue-selection.js`, `pinned-issues.js`,
    `keyboard-shortcuts.js`, `voice-notes.js` 등
  - 여러 API 호출을 묶은 작업: `merge-notes.js`, `attachment-prune.js`
  - 타이머·비동기 상태를 가진 컨트롤러: `deletion-queue.js`, `long-press.js`, `toast.js`,
    `transcription-hints.js`, `keyboard-ready-class.js`
  - 설정 저장: `settings-storage.js`, `voice-settings.js`, `sidebar-width.js`. 웹은
    `localStorage`, 설치형 앱은 `config.toml`과 OS 자격 증명 저장소(`app-config.js`,
    `settings-backend.js`)
  - 네이티브 셸 연동: `app-update.js`(웹 빌드 교체), `release-update.js`(앱 업데이트),
    `dialogs.js`(확인창), `native-api.js`
- `src-tauri/`: Tauri 셸. `ota.rs`(웹 빌드 교체), `settings.rs`(설정 파일·자격 증명·CLI),
  `release_update.rs`(앱 업데이트). `gen/android`, `gen/apple`은 직접 고쳐 쓰는 모바일 프로젝트다.
- `csp.config.js`: 콘텐츠 보안 정책과 HTTP 보안 헤더의 유일한 정의 위치(아래 CSP 절).
- `public/fonts/`: 편집기 코딩 폰트. 외부 CDN 대신 앱과 함께 배포하며
  `node scripts/fetch-editor-fonts.mjs`로 다시 받는다.
- 테스트는 대상 파일 옆의 `*.test.js`. `src/App.test.js`는 GitHub를 메모리 가짜 저장소로
  바꿔 화면 흐름 전체를 검증하고, 녹음기는 `src/lib/__mocks__/VoiceRecorder.svelte`를 쓴다.

## 지켜야 할 규칙

- **네이티브 호환성**: Tauri command·플러그인·권한을 늘리면 `src-tauri/src/ota.rs`의
  `NATIVE_API`와 `src/lib/native-api.js`의 `MIN_NATIVE_API`를 함께 올린다. 옛 앱이 새
  네이티브 기능을 쓰는 웹 빌드를 받지 않게 하는 값이다([APP_OTA](docs/APP_OTA.md)).
- **설정 항목**: 설정을 추가·변경하면 `src/lib/app-config.js`의 스키마도 고친다. 설치형 앱의
  `config.toml`과 그 주석이 이 스키마에서 만들어진다([CONFIG](docs/CONFIG.md)).
- **데이터 형식**: 첨부 경로·링크 형식과 잠금 암호문 형식은 이미 저장된 노트를 다시 읽는
  규약이다. 바꾸기 전에 [ATTACHMENTS](docs/ATTACHMENTS.md)와 [ENCRYPTION](docs/ENCRYPTION.md)의
  호환성 절을 따른다.
- **아이콘**: `src-tauri/icons/source/`의 SVG 두 장만 고치고 `npm run icons`로 모두 다시 만든다.
- **비밀값**: PAT, 서명 키, 개인 저장소 이름, 실제 노트 데이터를 커밋하지 않는다.

## 배포

`main`에 push하면 다음이 자동으로 진행된다. 별도 릴리스 브랜치는 없다.

- **웹**: `.github/workflows/ci.yml`이 `check`·`test`를 통과한 웹 빌드를 만들어 서명하고
  GitHub Pages(`https://zidell.github.io/ginote/`)에 올린다. 설치된 앱도 이 빌드로 바뀐다
  ([APP_OTA](docs/APP_OTA.md)). 필요한 시크릿은 `GINOTE_OTA_SIGNING_KEY`다. 서명 키가 없으면
  배포 job이 실패한다. 서명 없이 올리면 앱이 업데이트를 조용히 멈추기 때문이다.
- **데스크톱**: 같은 push가 네이티브 셸이나 패키징을 바꿨으면 `.github/workflows/release.yml`이
  macOS·Linux 릴리스와 Windows NSIS 설치 프로그램을 만든다. 대상 경로와 시크릿은 [DESKTOP](docs/DESKTOP.md)에
  있다. 그 밖에 릴리스가 필요하면 Actions의 "Desktop release"를 손으로 실행한다.
- **모바일**: 스토어 배포는 아직 자동화하지 않았다([MOBILE](docs/MOBILE.md)).

포크를 다른 정적 호스팅에 올릴 때는 `npm run build`의 `dist/`를 그대로 쓴다. 노트 잠금의
배포 pepper는 [ENCRYPTION](docs/ENCRYPTION.md)을 따른다.

## 보안 헤더와 CSP

CSP는 `csp.config.js` 한 곳에서 정의하고 두 곳에 반영한다.

- `index.html`의 `<meta>`: Vite 플러그인이 빌드 때 넣는다. 개발 서버에서는 HMR에 필요한 만큼만
  완화한 값을 쓴다.
- `src-tauri/tauri.conf.json`의 `csp`·`devCsp`: 자동 생성하지 않는다. `csp.test.js`가
  `csp.config.js`와 일치하는지 검사하고, 어긋나면 올바른 값을 출력한다.

주의할 점:

- GitHub Pages는 사용자 지정 HTTP 보안 헤더를 설정하지 못하므로 웹에는 `<meta>`의 CSP만 적용된다.
- `connect-src`의 `ipc:`와 `http://ipc.localhost`를 지우지 않는다. 앱은 웹과 같은 `dist`를
  쓰므로 `index.html`의 CSP가 Tauri WebView에도 적용되고, 이 둘이 없으면 IPC 호출이 막힌다.
- 폰트를 외부 CDN에서 불러오지 않는다. `font-src`·`style-src`를 그만큼 열어야 하고 사용자 IP가
  그 CDN으로 나간다. 새 폰트는 `scripts/fetch-editor-fonts.mjs`에 추가한다.
- `index.html` 안의 `<style>`은 `'unsafe-inline'` 대신 sha256 해시로 허용한다. 해시는 빌드가
  다시 계산한다.
