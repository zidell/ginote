# 개발·운영 안내

이 문서는 Ginote 웹 앱을 개발·검증·배포하는 기본 절차를 모읍니다. 첨부파일,
암호화, 데스크톱 앱처럼 별도 데이터 형식이나 배포 흐름을 가지는 기능은 이 문서에
중복해서 적지 않고 해당 문서를 기준으로 합니다.

## 개발 환경

CI는 Node.js 22와 `npm ci`를 사용합니다. 의존성을 변경할 때는 `package.json`과
`package-lock.json`을 함께 커밋하세요.

```bash
npm ci              # 잠금 파일 기준 설치
npm run dev         # 개발 서버
npm run check       # Svelte 정적 검사
npm test            # Vitest 전체 테스트
npm run test:watch  # 변경 감지 테스트
npm run build       # 프로덕션 빌드
npm run preview     # 빌드 결과 확인
```

변경을 마치기 전에는 최소한 다음 명령을 모두 통과시켜야 합니다.

```bash
npm run check
npm test
npm run build
```

`main` 브랜치 푸시와 pull request에서도 같은 검사를 GitHub Actions가 수행합니다.
CI는 `npm run test:coverage`로 커버리지를 만들어 Codecov에 올립니다.

## 코드 구조

- `src/App.svelte`: 화면 전체의 상태(워크스페이스, 노트 목록, 선택, 라우트)를 들고
  하위 컴포넌트와 모듈을 잇는 조립 지점입니다. 새 기능의 계산 로직이나 독립된 UI는
  여기에 직접 넣지 말고 아래 위치로 분리합니다.
- `src/lib/*.svelte`: 화면 조각입니다. 사이드바 목록(`NoteList`), 검색(`SidebarSearch`),
  다중 선택 도구(`SelectionToolbar`, `SelectionTagPanel`), 환경설정(`DisplaySettings`,
  `VoiceSettings`), 도움말(`HelpOverlay`), 저장소 추가(`AddWorkspaceDialog`), 노트
  편집기(`NoteEditor`) 등이 있습니다.
- `src/lib/*.js`: 화면과 무관한 로직입니다.
  - GitHub API 호출: `github.js`
  - 순수 계산: `app-routes.js`, `issue-labels.js`, `issue-selection.js`, `pinned-issues.js`,
    `keyboard-shortcuts.js`, `voice-notes.js` 등
  - 여러 API 호출을 묶은 작업: `merge-notes.js`, `attachment-prune.js`
  - 타이머나 비동기 상태를 가진 컨트롤러: `deletion-queue.js`, `long-press.js`, `toast.js`,
    `transcription-hints.js`, `keyboard-ready-class.js`
  - 브라우저 저장소: `settings-storage.js`, `draft-store.js`, `sidebar-width.js` 등. 설치형 앱은
    설정을 `config.toml`과 OS 자격 증명 저장소에 둡니다(`app-config.js`, `settings-backend.js`,
    [설정 파일](CONFIG.md)).
- `csp.config.js`: 콘텐츠 보안 정책과 HTTP 보안 헤더의 유일한 정의 위치입니다.
  아래 [보안 헤더와 CSP](#보안-헤더와-csp)를 참고하세요.
- `public/fonts/`: 편집기 코딩 폰트입니다. 외부 CDN 대신 앱과 함께 배포하며,
  `node scripts/fetch-editor-fonts.mjs`로 다시 내려받습니다.
- 테스트는 대상 파일 옆에 `*.test.js`로 둡니다. `src/App.test.js`는 GitHub를 메모리
  가짜 저장소로 바꿔 화면 흐름 전체를 검증하며, 녹음기는
  `src/lib/__mocks__/VoiceRecorder.svelte` 대역을 씁니다.

## 웹 배포

`main`에 push하면 CI(`.github/workflows/ci.yml`)가 `check`·`test`를 통과한 뒤 웹 빌드를
만들어 서명하고 Cloudflare Worker `ginote`(정적 자산, `note.gitools.net`)에 올립니다. Worker
설정은 `wrangler.jsonc`에 있습니다. 웹 빌드는 이 job에서만 만들며, Cloudflare 쪽 Git 자동
빌드(Workers Builds)는 쓰지 않습니다. 설치된 앱도 이 빌드로 다음 실행 때 바뀝니다
([앱 프론트엔드 자동 교체](APP_OTA.md)). 필요한 GitHub 시크릿은 다음과 같습니다.

- `GINOTE_OTA_SIGNING_KEY`
- `CLOUDFLARE_API_TOKEN`: Account · Workers Scripts · Edit 권한
- `CLOUDFLARE_ACCOUNT_ID`

서명 키가 없으면 배포 job이 실패합니다. 서명 없이 올리면 앱이 조용히 업데이트를 멈추기
때문입니다. 포크에서 다른 정적 호스팅에 올릴 때는 `npm run build`의 `dist/`를 그대로
쓰면 됩니다. PAT,
개인 저장소 이름, 개인 배포 설정, 실제 노트 데이터는 커밋하지 마세요. 노트 잠금의
배포 설정은 [노트 잠금과 암호화 방식](ENCRYPTION.md)을 따릅니다.

## 보안 헤더와 CSP

CSP는 `csp.config.js` 한 곳에서만 정의하고, 세 군데에 그 값을 흘려보냅니다.

- `index.html`의 `<meta>`: Vite 플러그인이 빌드할 때 넣습니다. 개발 서버에서는 HMR에
  필요한 만큼만 완화한 값을 씁니다.
- `dist/_headers`: 같은 플러그인이 빌드 산출물로 만듭니다. `public/`에 손으로 두지
  않으므로 고칠 일이 있으면 `csp.config.js`를 고칩니다.
- `src-tauri/tauri.conf.json`의 `csp`(앱 운영)와 `devCsp`(Tauri 개발 모드): 이 파일만
  자동 생성 대상이 아닙니다. `csp.test.js`가 `csp.config.js`와 일치하는지 검사하므로,
  어긋나면 테스트가 올바른 값을 알려줍니다.

지켜야 할 점이 몇 가지 있습니다.

- **`_headers`는 Cloudflare Workers 정적 자산·Pages·Netlify 형식입니다.** 이 파일을 읽지 않는 호스팅
  (GitHub Pages 등)에 올리면 HSTS나 `frame-ancestors` 같은 HTTP 보안 헤더가 적용되지
  않고 `<meta>`의 CSP만 남습니다.
- **`connect-src`의 `ipc:`와 `http://ipc.localhost`를 지우지 마세요.** 앱은 웹과 같은
  `dist`를 내장하거나 내려받아 쓰므로 `index.html`의 meta CSP가 그대로 Tauri WebView에도
  적용됩니다. 이 둘을 빼면 앱의 IPC 호출이 막힙니다.
- **폰트를 외부 CDN에서 불러오지 마세요.** `font-src`와 `style-src`를 그만큼 열어야
  하고, 폰트를 고른 사용자의 IP가 그 CDN으로 새어 나갑니다. 새 폰트는
  `scripts/fetch-editor-fonts.mjs`에 추가해 함께 배포합니다.
- `index.html` 안의 `<style>`은 `'unsafe-inline'` 대신 sha256 해시로 허용합니다.
  내용을 고치면 빌드가 해시를 다시 계산하므로 따로 할 일은 없습니다.

## 데이터와 기능별 운영 문서

- [첨부파일 저장 방식](ATTACHMENTS.md): 저장 규약, 권한, 보관과 호환성
- [노트 잠금과 암호화 방식](ENCRYPTION.md): 보호 경계와 배포 설정
- [데스크톱 앱 문서](DESKTOP.md): 로컬 실행, 패키징, 릴리스
- [앱 프론트엔드 자동 교체](APP_OTA.md): 매니페스트 규약, 서명 키, 네이티브 호환성
- [모바일 앱](MOBILE.md): Android·iOS 로컬 빌드, 직접 고친 네이티브 부분
- [코드 서명 정책](CODE_SIGNING.md): Windows 서명과 개인정보 처리 범위

## 미리보기 갱신

README의 미리보기 GIF를 변경할 때는 [미리보기 GIF 만들기](screencasting.md)의
준비물과 생성 절차를 따릅니다.
