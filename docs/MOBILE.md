# 모바일 앱

Ginote 모바일 앱은 데스크톱과 같은 Tauri 2 셸입니다. 웹과 같은 `dist`를 내장하고,
프론트엔드는 [앱 프론트엔드 자동 교체](APP_OTA.md)로 바뀝니다. 네이티브 프로젝트는
`src-tauri/gen/android`와 `src-tauri/gen/apple`에 커밋해 두고 직접 고쳐 씁니다.
`tauri android init`·`tauri ios init`을 다시 실행하면 아래 수정이 덮어써지므로 실행하지 않습니다.
설정 파일과 자격 증명(Android Keystore, iOS 키체인)은 [설정 파일](CONFIG.md)을 봅니다.

## Android

### 로컬 빌드와 실행

Android Studio(또는 SDK), JDK 17, NDK, Rust Android 타깃이 필요합니다.

```bash
~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager --install "ndk;30.0.16248370"
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

export ANDROID_HOME=~/Library/Android/sdk
export NDK_HOME=$ANDROID_HOME/ndk/30.0.16248370
npx tauri android build --debug --apk --target aarch64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

`--debug` 빌드도 내장 `dist`와 OTA를 그대로 씁니다(`tauri android dev`만 Vite 개발 서버를
엽니다). 디버그 빌드는 WebView 원격 디버깅이 켜져 있어 Chrome `chrome://inspect`나
`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`로 앱 안에서 코드를
실행해 볼 수 있습니다. 그 주소의 `http://localhost:9333/json`에서 WebSocket을 받아 CDP
`Runtime.evaluate`를 보냅니다. OTA 데이터는 `adb shell run-as net.gitools.note ls ota`로 봅니다.
화면이 두 개인 기기(Pixel Fold 등)는 `adb exec-out screencap`에 경고 문구가 섞이므로
`adb shell screencap -p /sdcard/s.png` 뒤 `adb pull`로 받습니다.

### 직접 고친 부분

- `app/src/main/AndroidManifest.xml`: 음성 메모용 `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`.
  WebView의 마이크 요청은 wry의 `RustWebChromeClient`가 런타임 권한 요청으로 이어 줍니다.
- `app/src/main/java/net/gitools/note/MainActivity.kt`
  - Android 15의 edge-to-edge 화면에서 시스템 바·화면 컷아웃·키보드 영역만큼 WebView를
    안쪽으로 들입니다. 웹 CSS의 safe-area 값은 WebView 버전마다 달라 쓰지 않습니다.
  - `GinoteAndroid.setTheme(dark)` JS 브리지로 시스템 바 뒤 배경과 아이콘 색을 웹 앱 테마에
    맞춥니다. 웹 쪽은 `applyTheme`(`src/lib/settings-storage.js`)이 부르며, 브리지가 없는
    셸에서는 아무것도 하지 않습니다.
- 런처 아이콘(`app/src/main/res/mipmap-*`)은 손으로 고치지 않고 `npm run icons`로 만듭니다.
  `tauri android init`·`tauri ios init`은 Tauri 기본 아이콘을 넣으므로, 프로젝트를 만든 뒤에는
  반드시 `npm run icons`를 다시 실행합니다. 아래 "아이콘"을 봅니다.

### 확인한 것 (2026-10-03, 에뮬레이터 Pixel Fold API 35)

- 내장 번들로 실행, 실제 `note.gitools.net`에서 OTA로 받아 다음 실행에 적용
- 출처 `http://tauri.localhost`, 보안 컨텍스트, `api.openai.com`·`api.github.com` CORS 통과
- 마이크 권한 창 → 허용 → `getUserMedia` 오디오 트랙 `live`
- 상태 바 겹침 없음, 테마에 따른 시스템 바 색, 키보드가 올라오면 화면 높이 축소
- 한 달 넘게 확인하지 못한 새 설치는 화면을 띄우기 전에 운영 빌드로 교체, 오프라인이면 바로
  내장본으로 실행
- 설정 파일 읽기, Keystore에 자격 증명 저장·조회·삭제

실기기와 스토어 서명·배포(업로드 keystore, Play Console)는 아직입니다.

## iOS

### 로컬 빌드와 실행

Xcode(`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`), CocoaPods
(`brew install cocoapods`, gem 설치는 sudo가 필요해 쓰지 않음), Rust iOS 타깃이 필요합니다.

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
npx tauri ios build --debug --target aarch64-sim
xcrun simctl install booted ~/Library/Developer/Xcode/DerivedData/ginote-*/Build/Products/debug-iphonesimulator/Ginote.app
```

`tauri ios build`가 마지막에 복사해 두는 `src-tauri/gen/apple/build/arm64-sim/Ginote.app`은
이미 있으면 갱신되지 않을 때가 있어(2026-10-03 확인), 설치는 DerivedData의 앱으로 합니다.
디버그 빌드의 WebView는 Safari 웹 속성이나 `ios_webkit_debug_proxy`로 원격 검사할 수 있습니다.
`ios_webkit_debug_proxy`는 시뮬레이터 소켓(`lsof -aUc launchd_sim`로 찾는
`com.apple.webinspectord_sim.socket`)에 붙이고, `Target.sendMessageToTarget`으로 감싼
`Runtime.evaluate`를 보냅니다. WebKit은 Promise 결과를 바로 돌려주지 않으므로 결과를 전역 변수에
담았다가 다시 읽습니다.

### 직접 고친 부분

- `src-tauri/Info.ios.plist`: 음성 메모용 `NSMicrophoneUsageDescription`. 빌드 때
  `gen/apple/ginote_iOS/Info.plist`로 합쳐집니다.
- 노치·상태 바 영역은 WKWebView가 비워 주므로 Android 같은 별도 처리가 없습니다.

### 확인한 것 (2026-10-03, 시뮬레이터 iPhone 16 iOS 18.5)

- 내장 번들로 실행, 운영 서버 매니페스트 검증(`last-check` 기록)
- 한 달 넘게 확인하지 못한 새 설치가 같은 실행 안에서 운영 빌드로 교체(약 3초)
- 출처 `tauri://localhost`, 보안 컨텍스트, `api.openai.com`·`api.github.com` CORS 통과
- `getUserMedia` 오디오 트랙 `live`. 시뮬레이터는 권한 창 없이 허용해, 권한 창 문구는 실기기에서
  확인해야 합니다.
- 설정 파일 읽기, 키체인에 자격 증명 저장·조회·삭제

실기기, Apple Distribution 인증서·프로비저닝 프로파일, App Store Connect 제출이 남았습니다.

## 아이콘

원본은 `src-tauri/icons/source/background.svg`(청록 노트 표지와 왼쪽 책등)와
`foreground.svg`(흰 라벨과 주황 태그, 투명 바탕) 두 장이고, `npm run icons`(`scripts/generate-icons.mjs`)가 모든 아이콘을 만듭니다.

- iOS·Android·PWA maskable·`apple-touch-icon.png`: 꽉 찬 정사각형. 둥근 모서리는 OS가
  마스크로 만듭니다. iOS는 투명한 부분을 허용하지 않습니다.
- Android 적응형 아이콘: 전경과 배경을 따로 넣고, 전경을 0.68배로 줄여 원형 마스크의 안전
  영역 안에 라벨과 태그가 들어오게 합니다.
- 데스크톱(`src-tauri/icons`)·`public/icon.svg`·파비콘·PWA any: 같은 그림에 둥근 모서리를
  씌웁니다.

로고를 바꿀 때는 두 SVG만 고치고 `npm run icons`를 실행합니다.
