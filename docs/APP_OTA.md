# 앱 프론트엔드 자동 교체(OTA)

Ginote 데스크톱·모바일 앱(Tauri 2)은 설치 파일에 웹과 같은 `dist`를 내장하고, 웹을
배포하면 다음 실행 때 `zidell.github.io/ginote`의 같은 빌드로 프론트엔드를 바꿉니다. 이 문서는
그 구조와 규약, 운영 방법을 설명합니다.

GitHub Pages 전환 전에 설치한 셸은 이전 웹 주소가 내장돼 있습니다. 데스크톱은 새 GitHub
릴리스로 업데이트하면 Pages 주소를 사용합니다. 모바일은 새 앱 빌드를 설치해야 주소가 바뀝니다.

- 앱은 가지고 있는 번들(내려받은 번들, 없으면 내장본)로 바로 뜹니다. 네트워크가 없어도
  앱 화면이 열립니다.
- 프론트엔드 수정에는 스토어 심사나 앱 재설치가 필요하지 않습니다. 웹 배포가 곧 앱
  배포입니다.
- 네이티브 코드(Rust, Tauri 플러그인, 권한, `Info.plist`·Android 매니페스트)를 바꾸면
  스토어 심사와 데스크톱 릴리스를 거칩니다.

## 결정과 근거

- **직접 구현**: 공식 `tauri-plugin-updater`는 바이너리 전체를 교체하고 모바일을 지원하지
  않습니다. `tauri-plugin-hot-update`는 설계가 같지만 2026-09-28에 나온 0.1.1이었고,
  CrabNebula OTA는 자체 클라우드에 묶여 있습니다. 필요한 코드가 수백 줄이라 직접
  구현했습니다(`src-tauri/src/ota.rs`). 네이티브 셸 자체의 업데이트에는 macOS·Linux에서
  공식 업데이터를 따로 씁니다([데스크톱 앱](DESKTOP.md)의 앱 업데이트).
- **단일 JS 대신 해시 목록 매니페스트**: CSS를 JS에 넣으려면 CSP에 `'unsafe-inline'`을
  열어야 합니다. `dist` 8.5MB 중 6.5MB가 에디터 폰트라, 해시가 같은 파일을 다시 받지 않는
  매니페스트 방식이 보통 배포에서 JS·CSS 약 1MB만 받습니다(2026-10-03 기준). 매니페스트는
  이미 배포된 파일을 가리키므로 zip을 따로 만들지 않습니다.
- **롤백 없음**: 새 빌드에 오류가 없다고 전제하고, 오류가 있으면 고친 빌드를 다시 배포해
  덮습니다. 업데이트 확인을 JS가 아니라 Rust가 하므로 프론트엔드가 하얀 화면으로 죽어도
  다음 실행 때 고친 빌드를 받아 옵니다. 이 확인을 JS로 옮기면 이 전제가 깨집니다.

## 웹 빌드: 매니페스트와 서명

`vite build`가 끝나면 `vite.config.js`의 `appManifestPlugin`이 `public/` 복사까지 끝난
`dist`를 훑어 `dist/app-manifest.json`을 만듭니다. 형식은 `app-manifest.config.js`가
만들고 `src-tauri/src/ota.rs`가 읽는 규약이므로, 바꿀 때는 두 쪽을 같은 커밋에서 고칩니다.

```json
{
  "format": 1,
  "build": 1790914653,
  "minNativeApi": 1,
  "files": {
    "assets/index-BR3BeAzZ.js": { "sha256": "…", "size": 587925 },
    "index.html": { "sha256": "…", "size": 6595 }
  }
}
```

- `build`: HEAD 커밋 시각(초)입니다. 같은 커밋을 웹과 앱에서 따로 빌드해도 같은 번호가
  나오고 커밋마다 커집니다. git이 없으면 빌드 시각을 씁니다. `GINOTE_BUILD_NUMBER`는 로컬
  시험용입니다. 앱은 지금 번들보다 큰 `build`만 받으므로 옛 매니페스트로 되돌리는 공격도
  막힙니다.
- `minNativeApi`: `src/lib/native-api.js`의 `MIN_NATIVE_API`입니다.
- `files`: `sw.js`, `og-image.png`, `landing-preview.gif`, `sitemap.xml`, `robots.txt`와 숨김 파일은
  앱에 내려보내지 않습니다.
- `app-manifest.json.sig`: 매니페스트 바이트 그대로에 대한 Ed25519 서명(base64)입니다.
  빌드 환경에 `GINOTE_OTA_SIGNING_KEY`가 있을 때만 만들어지고, 없으면 경고만 남깁니다.
  서명이 없는 빌드는 앱이 받지 않습니다. 파일 하나하나는 서명하지 않고, 서명된
  매니페스트의 sha256·크기와 맞는지만 확인합니다.

## 네이티브 호환성

프론트엔드가 새 Tauri command·플러그인·권한을 쓰기 시작하면 옛 셸에서는 그 호출이
실패합니다. 그래서 앱 버전과 별개인 정수를 둡니다.

- `src-tauri/src/ota.rs`의 `NATIVE_API`: 셸이 제공하는 수준
- `src/lib/native-api.js`의 `MIN_NATIVE_API`: 프론트엔드가 요구하는 수준

네이티브 표면을 넓히는 변경은 두 값을 함께 올리고 네이티브 릴리스와 짝을 이룹니다.
`minNativeApi`가 셸의 `NATIVE_API`보다 큰 빌드는 받지 않고 지금 번들에 머물며, 프론트엔드에
"앱 업데이트 필요" 알림을 띄웁니다(`src/lib/app-update.js`). 서버는 최신 빌드 하나만
두므로, 옛 셸은 마지막으로 호환되던 번들에 남습니다.

## 앱: 자산 제공과 교체

`src-tauri/src/lib.rs`는 `Context::set_assets`로 내장 자산을 꺼내 `OtaAssets`로 감쌉니다.

- `OtaAssets::setup`: `<app_local_data_dir>/ota/current`가 가리키는 번들이 있고 내장본보다
  새것이며 같은 내장본을 기준으로 만들어졌으면(`.base`) 이번 실행에 그 번들을 씁니다. 나머지 번들과 `tmp/`는 지웁니다. 내장본이 더
  새것이면(스토어 업데이트) 내려받은 번들을 버립니다.
- `get`: 고른 번들 폴더의 파일을 주고, 없으면 내장본으로 넘깁니다. 출처는 Tauri 기본값
  (`tauri://localhost`, Windows·Android는 `http://tauri.localhost`)이므로 번들이 바뀌어도
  WebView 저장소(초안 등)가 유지됩니다.
- `csp_hashes`: Tauri는 내장 HTML의 인라인 블록 해시를 컴파일할 때 계산합니다. 내려받은
  `index.html`은 고를 때 다시 계산해 넘깁니다.
- setup 전에 자산 요청이 오면 그 실행은 내장본으로 고정해 번들이 섞이지 않게 합니다.
- 개발 모드(`tauri dev`)에서는 번들을 쓰지도 받지도 않습니다.

```text
<app_local_data_dir>/ota/
  current             지금 쓸 번들의 build 번호
  bundles/<build>/…   검증을 마친 번들
  tmp/<build>/…       받는 중인 번들
```

### 업데이트 확인

setup이 끝나면 별도 스레드가 다음을 합니다. WebView `fetch`가 아니라 Rust(`ureq`,
webpki 루트 인증서)로 받으므로 웹의 CORS·CORP 헤더나 앱 CSP의 영향을 받지 않습니다.

1. `app-manifest.json`과 `.sig`를 받아 앱에 박힌 공개키로 서명을 검증합니다. 형식,
   `index.html` 포함 여부, 경로(번들 밖으로 나가는 경로 거부), 크기 제한도 확인합니다.
2. `build`가 지금 번들보다 크지 않으면 끝냅니다. `minNativeApi`가 맞지 않으면 업데이트
   필요 상태만 기록합니다.
3. 내장본 매니페스트와 sha256이 같은 파일은 번들에 담지 않습니다(실행 때 `get`이 내장본에서
   읽습니다). 지금 번들과 같은 파일은 복사만 하고, 나머지만 받아서 검증합니다. 하나라도 틀리면
   `tmp`를 지우고 다음 실행 때 다시 시도합니다. 처음에는 모든 파일을 내장본에서 풀어 해시를
   비교했는데, 디버그 빌드에서 20초를 넘겨(2026-10-03, iOS 시뮬레이터) 바꿨습니다. 지금은 보통
   배포에서 `index.html`과 JS 정도만 받아 3초 안에 끝납니다.
   번들에는 기준이 된 내장본의 build 번호(`.base`)를 적고, 스토어 업데이트로 내장본이 바뀌면
   그 번들을 버립니다.
4. `tmp/<build>`를 `bundles/<build>`로 rename하고 `current`를 원자적으로 바꿉니다. 다음
   실행부터 새 번들을 씁니다. 실행 중에는 새로고침하지 않으므로 작성 중인 초안을 잃지
   않습니다.
5. 결과를 `ota-status` 이벤트로 알립니다. 프론트엔드는 `ota_status` command로 이미 끝난
   결과도 읽습니다. 확인을 끝까지 마치면 `ota/last-check`에 시각을 남깁니다.

### 한 달 넘게 확인하지 못했으면 먼저 교체

평소에는 받은 빌드를 다음 실행에 적용하므로 가지고 있는 코드가 한 번은 그대로 돕니다. 오래된
코드가 그사이 바뀐 노트·첨부·암호화·설정 형식을 만지면 함께 쓰는 GitHub 데이터를 망가뜨릴
수 있어, 오래된 경우에는 화면을 띄우기 전에 교체합니다.

- 기준: 마지막으로 업데이트 확인을 끝까지 마친 시각(`ota/last-check`)에서
  `STALE_AFTER_SECS`(30일)가 지났는지. 확인한 적이 없으면(새로 설치) 지금 번들의 빌드
  시각(커밋 시각)을 씁니다. 빌드 날짜만으로 재면 `main`에 한 달 동안 커밋이 없을 때 매번
  기다리게 되므로 확인 시각을 기준으로 합니다.
- 흐름: `src/main.js`가 화면을 붙이기 전에 `prepareAppUpdate`로 `ota_status`를 묻고,
  `stale`이면 "업데이트하는 중" 안내를 띄운 뒤 `ota_prepare`를 부릅니다. 셸은 백그라운드
  확인이 끝나기를 최대 `PREPARE_TIMEOUT`(20초) 기다리고, 새 번들을 받았으면 지금 실행의
  번들을 바꿔 `true`를 돌려줍니다. 프론트엔드는 새로고침해 새 빌드로 뜹니다.
- 오프라인이거나 시간을 넘기면 가지고 있는 번들로 띄우고, 평소처럼 다음 실행에 적용합니다.
- 2026-10-03 정한 값입니다. 한 달이 맞지 않으면 사례를 보고 조정하고, 바꾼 값과 근거를
  여기에 남깁니다. 값이 Rust 상수라 바꾸려면 네이티브 릴리스가 필요합니다.
- Android 에뮬레이터에서 새로 설치한 오래된 빌드가 같은 실행 안에서 운영 빌드로 바뀌는 것과,
  오프라인에서 기다리지 않고 내장본으로 뜨는 것을 확인했습니다.

## 운영

### 서명 키

- 키 만들기: `node scripts/generate-ota-key.mjs <개인키 경로>`. 개인키는 그 파일에만
  쓰이고(권한 600) 화면에는 공개키만 나옵니다.
- 공개키는 `ota.rs`의 `OTA_PUBLIC_KEY`에 넣습니다. 공개키는 저장소에 있어도 됩니다.
- 개인키 파일 내용을 GitHub 저장소의 `GINOTE_OTA_SIGNING_KEY` 시크릿으로 등록합니다.
  웹 빌드와 서명은 CI의 `deploy-web` job에서만 합니다. 개인키는 저장소, 로그, 이슈 어디에도
  남기지 않습니다.
- 웹 빌드·서명·배포는 `main` push의 `deploy-web` job 한 곳, 앱 패키징은 네이티브가 바뀐
  `main` push(또는 손으로 실행)의 `release.yml` 한 곳입니다. 같은 커밋이면 빌드 번호와 결과물이 같습니다.
- 키를 바꾸면 이미 설치된 앱은 새 키로 서명된 빌드를 받지 못합니다. 새 공개키를 넣은
  네이티브 릴리스가 먼저 퍼져야 합니다.

### 포크와 로컬 시험

빌드할 때 환경 변수로 주소와 키를 바꿉니다. 포크는 자기 주소와 키를 써야 합니다.

```bash
GINOTE_OTA_BASE_URL=http://127.0.0.1:8765/ GINOTE_OTA_PUBLIC_KEY=<공개키> \
  GINOTE_BUILD_NUMBER=1000 npx tauri build --bundles app
```

같은 방법으로 build 2000짜리 `dist`를 로컬 서버에 올려, 첫 실행에서 바뀐 파일만 받고 두
번째 실행에서 적용되는 것을 확인했습니다(2026-10-03, macOS). 서버가 꺼진 상태에서도
내려받은 번들로 떴습니다.

실제 웹 빌드의 서명과 파일 해시를 앱의 공개키로 검증하려면 다음을 실행합니다.

```bash
GINOTE_OTA_SIGNING_KEY="$(cat <개인키 경로>)" npm run build
(cd src-tauri && GINOTE_OTA_DIST=../dist cargo test --lib -- --ignored built_manifest)
```

## 남은 일

- 모바일: Android 에뮬레이터와 iOS 시뮬레이터에서 OTA·마이크·CORS까지 확인했고, 실기기와
  스토어 제출이 남았습니다([모바일 앱](MOBILE.md)).
- Windows·Linux에서 같은 교체 흐름 확인
