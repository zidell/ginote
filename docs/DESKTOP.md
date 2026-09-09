# 데스크톱 앱 래핑

Ginote 데스크톱 앱은 Tauri 2로 웹 앱을 실행 파일에 패키징한 셸입니다. 프로덕션
`dist/` 파일을 번들에 포함하며, 별도 앱 서버 없이 GitHub API에 직접 연결합니다.

## 다운로드와 설치

macOS·Windows·Linux용 설치 파일은 [GitHub Releases](https://github.com/zidell/ginote/releases)에서
내려받을 수 있습니다.

macOS에서는 Homebrew로 설치할 수도 있습니다.

```bash
brew tap zidell/ginote https://github.com/zidell/ginote
brew install --cask ginote
```

## 로컬 실행과 패키징

Rust와 플랫폼별 [Tauri 사전 요구 사항](https://v2.tauri.app/start/prerequisites/)을
설치한 뒤 다음 명령을 사용합니다.

```bash
npm run tauri:dev
npm run tauri:build
```

`src-tauri/tauri.conf.json`의 `beforeBuildCommand`가 먼저 `npm run build`를
실행하고, 빌드 결과인 `dist/`를 Tauri 번들에 넣습니다. 웹 앱과 마찬가지로
데스크톱 앱도 GitHub API에 브라우저 컨텍스트에서 직접 연결합니다.

## GitHub Releases

릴리스 워크플로는 수동으로 실행할 때만 데스크톱 바이너리를 빌드합니다.
`.github/workflows/release.yml`은 GitHub Actions 실행 번호를 패치 버전에 넣어
`0.1.<run_number>` 형식의 버전을 만들고, 워크플로 안에서 루트 `package.json`에
주입합니다. 따라서 데스크톱 번들에도 같은 버전이 기록됩니다. 자동 버전 변경은
빌드 러너 안에서만 이루어져 저장소에 다시 커밋되거나 연쇄 빌드를 만들지 않습니다.

macOS universal, Windows, Linux 설치 파일을 만든 뒤 GitHub의 Releases 탭에
게시합니다. 모든 빌드가 끝나면 최신 릴리스 20개만 남기고, 그보다 오래된
릴리스와 연결된 버전 태그를 자동으로 삭제합니다.

릴리스와 배포 채널을 갱신하는 작업은 원본 `zidell/ginote` 저장소에서만 실행됩니다.
포크에서는 CI만 실행하고 릴리스, Homebrew, 향후 배포 채널 갱신은 수행하지
않습니다.

## 서명과 공증

다음 저장소 시크릿이 설정되어 있으면 macOS 빌드는 서명과 공증을 거칩니다.

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
```

시크릿이 설정되어 있지 않으면 `tauri.conf.json`의 `signingIdentity` 기본값인
`-`(ad-hoc)로 빌드되므로 macOS 최초 실행 시 경고가 표시될 수 있습니다. Windows
빌드는 신뢰할 수 있는 게시자 인증서로 서명되지 않습니다.

## Homebrew 배포 유지보수

`Casks/ginote.rb`는 원본 저장소의 릴리스 워크플로에 있는 `update-cask` 작업이
매 릴리스마다 최신 macOS universal DMG의 버전과 SHA-256으로 자동 갱신합니다.
변경 사항은 `main`에 GitHub Actions 봇이 직접 커밋합니다.
