# 데스크톱 앱 래핑

Ginote 데스크톱 앱은 Tauri 2 셸에서 [https://note.gitools.net](https://note.gitools.net)을
엽니다. UI와 일반적인 기능 수정은 웹 배포로 반영되며, 데스크톱 셸이나 권한·설치
방식 변경에는 새 설치 파일이 필요합니다. 앱은 인터넷 연결이 필요하고 GitHub API에
직접 연결합니다.

## 다운로드와 설치

[GitHub Releases](https://github.com/zidell/ginote/releases)에서 macOS는 DMG,
Windows 10/11은 MSI를 내려받아 설치합니다. Linux 패키지도 제공됩니다.
새 Windows 릴리스는 SignPath Foundation 인증서 설정 후 서명된 MSI로 게시합니다.
기존 릴리스의 Windows 설치 파일은 서명되지 않았습니다. Microsoft Store에는
등록하지 않습니다. Windows의 평판 경고는 서명 후에도 다운로드 수와 평판에 따라
나타날 수 있습니다.

macOS에서는 Homebrew로 설치할 수도 있습니다.

```bash
brew tap zidell/ginote https://github.com/zidell/ginote
brew install --cask ginote
```

기존 Ginote 데스크톱 앱의 로컬 저장소는 새 `https://note.gitools.net` 출처로
자동 이전되지 않습니다. 업데이트 전에 저장되지 않은 초안·대기 작업을 완료하고,
업데이트 후 GitHub PAT와 선택적으로 OpenAI API 키를 다시 입력하세요. 웹 브라우저에
저장한 설정도 데스크톱 앱과 별도입니다.

## 로컬 실행과 패키징

Rust와 플랫폼별 [Tauri 사전 요구 사항](https://v2.tauri.app/start/prerequisites/)을
설치한 뒤 다음 명령을 사용합니다.

```bash
npm run tauri:dev
npm run tauri:build
```

개발 모드는 로컬 Vite 서버를 열고, 프로덕션 빌드는 웹 주소를 엽니다. Windows에서
MSI만 만들려면 `npm run tauri:build -- --bundles msi`를 사용합니다. 웹 앱 자체는
`npm run build`로 별도 빌드해 배포합니다.

## GitHub Releases

릴리스 워크플로는 수동 실행 시에만 데스크톱 바이너리를 빌드합니다. GitHub
Actions 실행 번호를 `0.1.<run_number>` 버전에 넣으며, 저장소에는 버전 변경을
커밋하지 않습니다.

macOS DMG와 Linux 패키지를 초안 릴리스에 올립니다. Windows MSI는 GitHub가
호스팅하는 Windows 러너에서 빌드해 SignPath에 한 번 제출합니다. SignPath가 MSI와
내부 `ginote.exe`를 서명한 뒤, 서명을 확인한 MSI만 초안 릴리스에 올립니다.
서명 요청이 거절되거나 실패하면 릴리스는 게시되지 않습니다. 무료 SignPath
Foundation 인증서는 **데스크톱 바이너리를 새로 릴리스할 때마다 수동 서명 승인**이
필요합니다. 웹 앱만 배포할 때는 데스크톱 빌드나 서명 요청이 발생하지 않습니다.

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

Windows 서명을 처음 설정할 때는 [SignPath Foundation에 신청](https://signpath.org/apply.html)해
오픈소스 서명 승인을 받고, GitHub 앱과 GitHub Trusted Build System을 연결해야
합니다. SignPath 프로젝트 슬러그는 `ginote`, 서명 정책은 `release-signing`,
아티팩트 구성은 `windows-msi`로 만들고
[windows-msi.xml](../.signpath/windows-msi.xml)의 내용을 등록합니다. GitHub
저장소에는 `SIGNPATH_API_TOKEN` 시크릿과 `SIGNPATH_ORGANIZATION_ID` 변수를
설정합니다. API 토큰에는 해당 정책의 서명 요청 권한이 필요합니다.

설정 후 `./release.sh`를 실행하면 워크플로가 서명 승인까지 기다립니다. 승인한
바이너리 릴리스가 성공한 뒤에는 웹 앱의 일반적인 수정은 웹 배포만 하면 됩니다.
서명 정책과 개인정보 안내는 [Code signing policy](CODE_SIGNING.md)에 있습니다.

## Homebrew 배포 유지보수

`Casks/ginote.rb`는 릴리스 워크플로가 최신 macOS universal DMG의 버전과
SHA-256으로 자동 갱신합니다. 변경 사항은 `main`에 GitHub Actions 봇이
커밋합니다.
