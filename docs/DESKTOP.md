# 데스크톱 앱

Ginote 데스크톱 앱은 웹과 같은 빌드를 Tauri 2 셸에 내장해 오프라인에서도 열립니다. 화면과
일반 기능 수정은 웹 배포로 반영되고, 앱은 `https://zidell.github.io/ginote/`의 새 빌드를 받아 다음
실행부터 씁니다([앱 프론트엔드 자동 교체](APP_OTA.md)). 셸·권한·패키징이 바뀌면 새 릴리스를
설치해야 합니다. 노트 동기화는 GitHub API에 직접 연결합니다.

macOS 앱에서는 `Cmd+1`~`Cmd+9`로 등록 순서의 저장소로 전환할 수 있습니다. 편집기 입력 중에도
동작합니다. 목록에서 수정 키 없이 `1`~`9`를 누르는 기존 단축키도 사용할 수 있습니다.

## 배포 형태

| 플랫폼 | 배포 | 업데이트 |
| --- | --- | --- |
| macOS | [GitHub Releases](https://github.com/zidell/ginote/releases)의 DMG, Homebrew 탭 | 앱 업데이터 |
| Linux | GitHub Releases의 AppImage, deb, rpm | 앱 업데이터 |
| Windows | GitHub Releases의 NSIS 설치 프로그램 | 앱 업데이터 |

Homebrew는 이 저장소를 탭으로 씁니다. Homebrew 공식 cask 저장소에는 등록하지 않습니다.

```bash
brew tap zidell/ginote https://github.com/zidell/ginote
brew install --cask ginote
```

## 앱 업데이터 (macOS·Linux·Windows)

- 실행 10초 뒤와 그 뒤 6시간마다 최신 GitHub 릴리스의 `latest.json`을 확인합니다. 새 버전이
  있으면 "이 버전 건너뛰기 / 나중에 / 지금 설치" 창을 띄우고, 설치가 끝나면 지금 다시
  시작할지 묻습니다.
- Linux는 AppImage·deb·rpm 모두 설치된 형식 그대로 갱신합니다.
- Windows는 NSIS 설치 프로그램으로 새 버전을 설치합니다.
- 자동 확인 여부와 건너뛴 버전은 `config.toml`의 `[updates]`에 있습니다([설정 파일](CONFIG.md)).
  설정 화면의 "앱 업데이트"에서 바로 확인할 수도 있습니다.
- Homebrew cask에는 `auto_updates true`를 두어 `brew upgrade`가 앱 업데이터와 겹치지 않게 합니다.
- 구현: `src-tauri/src/release_update.rs`, `src/lib/release-update.js`,
  `src/lib/ReleaseUpdateDialog.svelte`, `src/lib/AppUpdateSettings.svelte`.

업데이트 파일은 Tauri 업데이터 키로 서명합니다. 공개키는 `src-tauri/tauri.conf.json`의
`plugins.updater.pubkey`에 있고, 앱은 이 키로 서명된 파일만 설치합니다. 개인키를 잃으면 이미
설치된 앱이 이후 릴리스를 받지 못하므로 개인키와 비밀번호를 저장소 밖에 백업합니다. 키를
바꿀 때는 새 공개키를 넣은 릴리스를 옛 키로 서명해 한 번 내보낸 뒤 시크릿을 바꿉니다.

## 로컬 빌드

```bash
npm run tauri:dev     # 로컬 Vite 서버를 여는 개발 모드
npm run tauri:build   # npm run build의 dist를 내장한 프로덕션 빌드
```

업데이트 파일까지 만들려면 `TAURI_SIGNING_PRIVATE_KEY`·`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`를
환경에 두고 `--config src-tauri/tauri.release.conf.json`을 붙입니다.

로컬 빌드는 앱 업데이트(새 릴리스 설치)를 확인하지 않습니다. 버전이 `0.1.0`으로 찍혀 늘 새 릴리스를 권하고,
설치하면 고쳐 쓰던 로컬 빌드를 덮어쓰기 때문입니다. 릴리스 워크플로는 빌드 때 `GINOTE_RELEASE_BUILD=1`을 넣어
확인을 켭니다. 로컬 빌드에서 업데이트 화면을 시험하려면 같은 값을 넣고 빌드합니다.

### 로컬 빌드를 설치해 쓰기 (macOS)

고치면서 바로 확인하려고 배포본 대신 로컬 빌드를 `/Applications`에 두고 쓸 수 있습니다. 배포본(Homebrew·DMG)과
함께 두지 않습니다. Homebrew로 설치했다면 `brew uninstall --cask ginote`로 먼저 지웁니다.

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: <이름> (<팀 ID>)" npx tauri build --bundles app
osascript -e 'tell application "Ginote" to quit'
rm -rf /Applications/Ginote.app && cp -R src-tauri/target/release/bundle/macos/Ginote.app /Applications/
open /Applications/Ginote.app
```

- 서명 인증서가 있으면 `APPLE_SIGNING_IDENTITY`로 서명합니다. 임시 서명(`-`)은 빌드마다 앱 식별값이 바뀌어
  다시 빌드할 때마다 키체인 접근을 또 묻습니다. 공증은 하지 않아도 이 Mac에서는 열립니다.
- 웹 화면은 배포된 웹 빌드가 더 새로우면(빌드 번호 = 커밋 시각) OTA로 그것으로 바뀝니다. 고친 화면은 다시
  빌드해 설치하면 보입니다. 옛 OTA 번들이 로컬 빌드보다 앞서면
  `~/Library/Application Support/net.gitools.note/ota/`를 지웁니다.
- Finder·Dock에 예전 아이콘이 남으면 `lsregister -f /Applications/Ginote.app`(LaunchServices) 뒤 `killall Dock`.

## 릴리스

`main`에 push했을 때 다음 경로가 바뀌었으면 `.github/workflows/release.yml`이 릴리스합니다.

- `src-tauri/`(모바일 프로젝트 `src-tauri/gen/` 제외)
- `scripts/windows/`, `scripts/updater-manifest.mjs`
- `.github/workflows/release.yml`

화면과 일반 기능 수정은 웹 배포로 설치된 앱에 들어가므로 릴리스하지 않습니다. 그래서 설치된
앱이 push마다 업데이트를 권하지 않습니다. 다른 이유로 릴리스가 필요하면 Actions의
"Desktop release"를 손으로 실행합니다.

- 버전은 `0.1.<워크플로 실행 번호>`입니다. 실패한 실행도 번호를 쓰므로 번호가 건너뛸 수
  있습니다. 저장소에는 버전 변경을 커밋하지 않습니다.
- macOS(universal)·Linux·Windows 빌드가 설치 파일, 업데이트 파일, 서명(`.sig`)을 초안 릴리스에
  올립니다. 세 빌드가 끝나면 `scripts/updater-manifest.mjs`가 서명을 모아 `latest.json`을
  만들고 릴리스를 게시합니다.
- Windows 설치 프로그램도 같은 GitHub 릴리스에 올립니다(아래 Windows).
- 게시 뒤 최신 20개 릴리스만 남기고, `Casks/ginote.rb`의 버전과 SHA-256을 GitHub Actions
  봇이 `main`에 커밋합니다.
- 릴리스는 원본 `zidell/ginote` 저장소의 `main`에서만 실행됩니다.

필요한 시크릿:

```text
APPLE_CERTIFICATE              macOS 서명·공증
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
TAURI_SIGNING_PRIVATE_KEY      업데이트 파일 서명
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

## Windows

Tauri NSIS 설치 프로그램(`*-setup.exe`)을 GitHub Releases에 올립니다. Microsoft Store에는
등록하지 않습니다. 설치 파일을 실행해 설치하고, 이후 새 버전은 앱 안의 업데이터가 안내합니다.
설치 프로그램은 현재 Windows 코드 서명이 없어 Windows 보안 경고가 나올 수 있습니다.
Windows 11과 업데이트된 Windows 10에는 필요한 WebView2 런타임이 기본으로 들어 있습니다.
과거의 Store 시험용 MSIX 워크플로는 릴리스에서 호출하지 않습니다.

1. [최신 릴리스](https://github.com/zidell/ginote/releases/latest)의 Assets에서 파일 이름이
   `x64-setup.exe`로 끝나는 설치 프로그램을 내려받습니다.
2. 파일을 실행할 때 **“Windows의 PC 보호”**가 나오면 **“추가 정보”**를 누릅니다.
3. 앱 이름이 받은 Ginote 파일과 같은지 확인한 뒤 **“실행”**을 눌러 설치합니다. 브라우저의
   다운로드 경고는 별개이며, 다운로드 목록의 파일 메뉴에서 **“유지”**를 선택해야 할 수 있습니다.

설치 파일은 반드시 `github.com/zidell/ginote`의 릴리스에서 받습니다. Windows의 Smart App
Control이 파일을 완전히 차단하는 환경에서는 “추가 정보”가 나타나지 않을 수 있습니다.
