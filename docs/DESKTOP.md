# 데스크톱 앱 래핑

Ginote 데스크톱 앱은 웹과 같은 빌드를 Tauri 2 셸에 내장해 오프라인에서도 열립니다.
UI와 일반적인 기능 수정은 웹 배포로 반영되며, 앱이 다음 실행 때
[https://note.gitools.net](https://note.gitools.net)의 같은 빌드로 프론트엔드를 바꿉니다
([앱 프론트엔드 자동 교체](APP_OTA.md)). 데스크톱 셸이나 권한·설치 방식 변경에는 새 설치
파일이 필요합니다. 노트 동기화는 GitHub API에 직접 연결합니다.

## 다운로드와 설치

- macOS: [GitHub Releases](https://github.com/zidell/ginote/releases)의 DMG 또는 Homebrew.
- Linux: GitHub Releases의 AppImage, deb, rpm.
- Windows: Microsoft Store와 MSIX로 배포합니다(아래 [Windows](#windows)).

```bash
brew tap zidell/ginote https://github.com/zidell/ginote
brew install --cask ginote
```

## 앱 업데이트

업데이트는 두 갈래입니다.

| 무엇이 바뀌나 | 어떻게 받나 |
| --- | --- |
| 화면과 일반 기능(웹 빌드) | 앱이 실행 중에 note.gitools.net의 새 빌드를 받아 다음 실행부터 씁니다([앱 프론트엔드 자동 교체](APP_OTA.md)). |
| 네이티브 셸(Tauri, 플러그인, 권한) | 새 릴리스를 설치해야 합니다. 플랫폼마다 아래처럼 받습니다. |

- **macOS·Linux**: 앱이 실행 10초 뒤와 그 뒤 6시간마다 GitHub 릴리스의 `latest.json`을
  확인하고, 새 버전이 있으면 "이 버전 건너뛰기 / 나중에 / 지금 설치" 창을 띄웁니다
  (Sparkle과 같은 흐름). 설치가 끝나면 지금 다시 시작할지 묻습니다. Linux는 AppImage·deb·rpm
  모두 받은 형식 그대로 갱신합니다. 자동 확인 여부와 건너뛴 버전은 `config.toml`의
  `[updates]`에 있고([설정 파일](CONFIG.md)), 설정 화면의 "앱 업데이트"에서 바로 확인할 수
  있습니다. 구현은 `src-tauri/src/release_update.rs`, `src/lib/release-update.js`,
  `src/lib/ReleaseUpdateDialog.svelte`입니다.
- **Homebrew**: cask에 `auto_updates true`가 있어 앱 업데이터와 `brew upgrade`가 충돌하지
  않습니다.
- **Windows**: Microsoft Store와 App Installer가 업데이트합니다. 앱 업데이터는 쓰지 않습니다.
- **iOS·Android**: 스토어가 업데이트합니다.

업데이트 파일은 Tauri 업데이터 서명 키로 서명합니다. 공개키는
`src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에 들어 있고, 앱은 이 키로 서명된
파일만 설치합니다. **개인키를 잃으면 이미 설치된 앱이 이후 릴리스를 받지 못하므로** 개인키와
비밀번호를 저장소 밖에 백업해 둡니다. 키를 바꿔야 하면 새 공개키를 넣은 릴리스를 옛 키로
서명해 한 번 내보낸 뒤 시크릿을 바꿉니다.

## 로컬 실행과 패키징

Rust와 플랫폼별 [Tauri 사전 요구 사항](https://v2.tauri.app/start/prerequisites/)을
설치한 뒤 다음 명령을 사용합니다.

```bash
npm run tauri:dev
npm run tauri:build
```

개발 모드는 로컬 Vite 서버를 열고, 프로덕션 빌드는 `npm run build`로 만든 `dist`를
내장합니다. 웹 앱은 `npm run build`로 별도 빌드해 배포하며, 배포 환경에
`GINOTE_OTA_SIGNING_KEY`가 있어야 설치된 앱이 그 빌드를 받습니다. 업데이트 파일까지
만들려면 `TAURI_SIGNING_PRIVATE_KEY`·`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`를 두고
`--config src-tauri/tauri.release.conf.json`을 붙입니다.

## GitHub Releases

`main`에 push하면 네이티브 셸이나 패키징이 바뀐 경우에만 데스크톱 릴리스가 실행됩니다
(`src-tauri/`(모바일 `gen/` 제외), `scripts/windows/`, `scripts/updater-manifest.mjs`, 릴리스·MSIX
워크플로). 화면과 일반 기능 수정은 웹 배포로 설치된 앱에 들어가므로 릴리스하지 않고, 그래서
설치된 앱이 push마다 업데이트를 권하지도 않습니다. 그 밖에 새 릴리스가 필요하면 Actions의
"Desktop release"를 손으로 실행합니다. GitHub Actions 실행 번호를 `0.1.<run_number>` 버전에
넣으며, 저장소에는 버전 변경을 커밋하지 않습니다.

macOS(universal)와 Linux 빌드가 설치 파일과 함께 업데이트 파일과 그 서명(`.sig`)을 초안
릴리스에 올립니다. 두 빌드가 끝나면 `scripts/updater-manifest.mjs`가 서명을 모아
`latest.json`을 한 번에 만들어 올리고 릴리스를 게시합니다. 게시된 최신 릴리스의
`latest.json`이 설치된 앱이 확인하는 주소입니다.

모든 작업이 성공하면 릴리스를 게시하고 최신 20개만 유지합니다. 릴리스와 배포
채널 갱신은 원본 `zidell/ginote` 저장소에서만 실행됩니다.

## 서명 설정

macOS 서명과 공증에는 다음 GitHub 저장소 시크릿이 필요합니다.

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
```

업데이트 파일 서명에는 `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
시크릿이 필요합니다.

## Windows

Windows는 Tauri 앱을 MSIX로 묶어 Microsoft Store로 배포합니다. Store 판은 Microsoft가
서명하고 Store가 업데이트하므로, 앱 업데이터는 Windows에서 쓰지 않습니다.

- 패키징: `.github/workflows/windows-msix.yml`이 `ginote.exe`를 만들고(`tauri build --no-bundle`)
  `scripts/windows/package-msix.ps1`이 `src-tauri/windows/AppxManifest.xml`을 채워 MSIX로
  묶습니다. 릴리스 워크플로가 같은 버전(`0.1.<실행 번호>.0`)으로 부르고, 손으로 실행하면
  패키징 점검만 합니다.
- 점검: 매번 시험용 인증서로 서명한 패키지를 러너에 설치하고, 실행 별칭으로
  `ginote --config-path`가 패키지 전용 설정 폴더를 가리키는지 확인한 뒤 지웁니다.
- 설정 파일: MSIX 안에서 앱이 `%APPDATA%`에 쓰는 파일은 Windows가
  `%LOCALAPPDATA%\Packages\<패키지 패밀리 이름>\LocalCache\Roaming\` 아래로 옮겨 둡니다.
  `ginote --config-path`가 이 실제 위치를 알려 줍니다([설정 파일](CONFIG.md)).
- 명령줄: 매니페스트의 실행 별칭으로 터미널에서 `ginote --help`, `ginote --config-path`를 쓸 수
  있습니다. 릴리스 빌드는 GUI 앱이라 콘솔 창을 띄우지 않고, 명령줄 출력은 부모 콘솔에 붙어
  내보냅니다.
- WebView2: MSIX는 WebView2 런타임을 설치하지 않습니다. Windows 11과 업데이트된
  Windows 10에는 기본으로 들어 있습니다.
- Store 판 ID: Partner Center에서 앱 이름을 예약하면 받는 값을 저장소 변수
  `MSSTORE_IDENTITY_NAME`, `MSSTORE_PUBLISHER`, `MSSTORE_PUBLISHER_DISPLAY_NAME`에 넣습니다.
  값이 있으면 릴리스마다 Store 제출용 MSIX를 워크플로 산출물(`ginote-store-msix`)로 남깁니다.
- Store 밖 MSIX: 서명 인증서(SignPath Foundation 승인 후)가 생기면 그 인증서 주체를
  Publisher로 넣은 MSIX와 `.appinstaller`를 GitHub 릴리스에 올려, Windows App Installer가
  실행할 때 새 버전을 확인하게 합니다.

## Homebrew 배포 유지보수

`Casks/ginote.rb`는 릴리스 워크플로가 최신 macOS universal DMG의 버전과
SHA-256으로 자동 갱신합니다. 앱이 스스로 업데이트하므로 cask에 `auto_updates true`를 둡니다. 변경 사항은 `main`에 GitHub Actions 봇이
커밋합니다.
