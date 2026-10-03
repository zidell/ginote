# 설치형 앱의 설정 파일과 자격 증명

설치형 앱(데스크톱·iOS·Android)은 설정을 WebView의 `localStorage`가 아니라 사용자 설정
폴더의 `config.toml`에 두고, PAT와 OpenAI 키는 OS 자격 증명 저장소에 둡니다. 사람이나
AI 에이전트가 앱 화면을 열지 않고도 설정을 찾아 바꿀 수 있게 하려는 구조이며,
[Agent Configuration Accessibility](https://github.com/zidell/agent-configuration-accessibility)
지침을 따릅니다. 웹 앱은 파일 시스템이 없으므로 `localStorage`를 씁니다.

## 저장 위치

| 대상 | 위치 |
| --- | --- |
| 설정 파일 | macOS `~/Library/Application Support/net.gitools.note/config.toml`, Linux `~/.config/net.gitools.note/config.toml`, Windows(MSIX) `%LOCALAPPDATA%\Packages\<패키지 패밀리 이름>\LocalCache\Roaming\net.gitools.note\config.toml`, 모바일은 앱 샌드박스의 같은 이름 파일. 실제 경로는 `ginote --config-path`가 출력합니다. |
| 읽기 결과 | 같은 폴더의 `config-status.txt` |
| PAT | 자격 증명 저장소, 서비스 `net.gitools.note`, 이름 `github-pat:<워크스페이스 id>` |
| OpenAI 키 | 자격 증명 저장소, 서비스 `net.gitools.note`, 이름 `openai-api-key` |
| 설치 안내 | macOS `Ginote.app/Contents/Resources/readme.txt`, Windows는 패키지 안 실행 파일 옆, Linux는 `/usr/lib/Ginote/readme.txt` |

자격 증명 저장소는 macOS 키체인, iOS 키체인(데이터 보호), Windows 자격 증명 관리자,
Linux Secret Service, Android Keystore로 암호화한 SharedPreferences입니다. 저장소를 쓸 수
없는 환경(예: Secret Service가 없는 Linux)에서만 `localStorage`의
`issue-note.secrets-fallback.v1`에 평문으로 둡니다.

보호 범위: macOS·iOS·Android에서는 다른 프로세스가 파일을 읽어도 자격 증명이 나오지
않습니다. macOS에서 다른 프로그램이 키체인 항목을 읽으려 하면 시스템이 사용자에게
허용 여부를 묻습니다. Windows 자격 증명 관리자와 잠금 해제된 Linux Secret Service는 같은
사용자로 실행되는 프로그램이 API로 읽을 수 있으므로, 이 두 플랫폼에서는 "설정 파일을 읽다가
실수로 노출되는 일"까지만 막습니다.

## 구성

```text
main.js ─ initInstalledSettings() ─┬─ settings_read ─→ config.toml (src-tauri/src/settings.rs)
                                   ├─ secret_get   ─→ OS 자격 증명 저장소
                                   └─ installed-settings.js 메모리 사본에 담음
settings-storage.js / voice-settings.js / sidebar-width.js
   load*()  → 설치형이면 메모리 사본, 웹이면 localStorage
   save*()  → 설치형이면 사본을 고치고 settings-backend.js가 파일·자격 증명에 다시 씀
settings_write ─→ config.toml ─(1초 간격 감시)─→ settings-file-changed ─→ App.svelte 반영
```

- `src/lib/app-config.js`: 파일 형식의 유일한 정의입니다. 키마다 뜻·타입·허용값·기본값·
  적용 시점을 적고, 이 정의로 파일을 쓰고(`renderConfig`) 읽어 검증합니다(`parseConfig`).
  설정 항목을 추가·변경할 때는 여기의 `ENTRIES`와 `normalizePreferences` 등 기존 정규화
  함수를 함께 고칩니다.
- `src/lib/settings-backend.js`: 시작 시 읽기, 처음 실행 시 이관, 저장 큐, 바깥 변경 감지,
  `config-status.txt` 기록을 맡습니다.
- `src-tauri/src/settings.rs`: 파일 원자적 쓰기, 자격 증명 command, 변경 감시, CLI
  (`--help`, `--config-path`)입니다. CLI는 창을 만들기 전에 처리하고 종료합니다.
- `src-tauri/resources/readme.txt`: 설치 패키지에 들어가는 안내입니다. 설정 위치·적용·
  검증·자격 증명을 이 파일만으로 알 수 있게 씁니다.

## 동작 규칙

- **처음 실행**: `config.toml`이 없으면 `localStorage`의 기존 설정·PAT·OpenAI 키를 파일과
  자격 증명 저장소로 옮긴 뒤 `localStorage`에서 지웁니다. 다 쓴 뒤에만 지웁니다.
- **앱에서 바꿀 때**: 파일 전체를 스키마로 다시 씁니다. 주석은 항상 남고, 사용자가 덧붙인
  주석과 키 순서는 남지 않습니다. 자격 증명은 바뀐 항목만 저장소에 쓰고, 목록에서 빠진
  워크스페이스나 `remember_token = false`가 된 워크스페이스의 PAT는 지웁니다.
- **바깥에서 바꿀 때(데스크톱)**: 1초 안에 다시 읽어 테마·언어·글꼴·목록 폭·음성 설정과
  워크스페이스 목록·순서·이름·활성 워크스페이스를 바로 반영합니다. 앱이 방금 쓴 내용과
  같으면 무시합니다. 파일은 고친 사람이 쓴 그대로 두며, id가 없는 새 워크스페이스에 id를
  붙여야 할 때만 다시 씁니다. 모바일은 다음 실행 때 읽습니다.
- **잘못된 값**: 해당 항목만 기본값이나 가장 가까운 허용값으로 바꿔 쓰고
  `config-status.txt`에 항목·이유·사용한 값을 적습니다. 모르는 키도 적습니다.
- **TOML 문법 오류**: 파일 전체를 무시하고 지금 설정을 유지합니다. 실행 중이면 알림을
  띄우고, 시작할 때 깨져 있으면 마지막 정상 설정(`localStorage`의
  `issue-note.installed-settings.v1`, 자격 증명 제외)으로 띄웁니다. 앱에서 설정을 바꾸면
  그 값으로 파일을 다시 씁니다.
- **첫 화면 테마**: 파일을 읽기 전 첫 페인트에는 위의 마지막 정상 설정의 테마를 씁니다.

## 설정 파일에 넣지 않는 것

- PAT, OpenAI 키: 자격 증명 저장소에 둡니다. 앱에서만 입력·교체할 수 있습니다.
- OpenAI 모델 목록 캐시, 작성 중 초안, 처리 대기 작업, 첨부파일 정리 기록: 설정이 아니라
  앱이 관리하는 상태라서 `localStorage`에 둡니다.
- 전사 단어: 저장소를 쓰는 모든 기기가 함께 쓰는 값이라 노트 저장소의
  `.issue-note-assets/voice-hints.json`에 둡니다.

## 확인

```bash
npx vitest run src/lib/app-config.test.js src/lib/settings-backend.test.js
(cd src-tauri && cargo test --lib settings)
/Applications/Ginote.app/Contents/MacOS/ginote --config-path
```
