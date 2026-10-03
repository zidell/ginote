# 모바일 앱

Ginote 모바일 앱은 데스크톱과 같은 Tauri 2 셸입니다. 웹과 같은 `dist`를 내장하고,
프론트엔드는 [앱 프론트엔드 자동 교체](APP_OTA.md)로 바뀝니다. 네이티브 프로젝트는
`src-tauri/gen/android`(그리고 이후 `src-tauri/gen/apple`)에 커밋해 두고 계속 고쳐 씁니다.
다시 `tauri android init`을 실행하면 아래 수정이 덮어써지므로 하지 않습니다.

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
실행해 볼 수 있습니다. OTA 데이터는 `adb shell run-as net.gitools.note ls ota`로 봅니다.

### 직접 고친 부분

- `app/src/main/AndroidManifest.xml`: 음성 메모용 `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`.
  WebView의 마이크 요청은 wry의 `RustWebChromeClient`가 런타임 권한 요청으로 이어 줍니다.
- `app/src/main/java/net/gitools/note/MainActivity.kt`
  - Android 15의 edge-to-edge 화면에서 시스템 바·화면 컷아웃·키보드 영역만큼 WebView를
    안쪽으로 들입니다. 웹 CSS의 safe-area 값은 WebView 버전마다 달라 쓰지 않습니다.
  - `GinoteAndroid.setTheme(dark)` JS 브리지로 시스템 바 뒤 배경과 아이콘 색을 웹 앱 테마에
    맞춥니다. 웹 쪽은 `applyTheme`(`src/lib/settings-storage.js`)이 부르며, 브리지가 없는
    셸에서는 아무것도 하지 않습니다.
- `app/src/main/res/mipmap-*`, `values/ic_launcher_background.xml`: `tauri android init`은
  Tauri 기본 아이콘을 넣으므로 `src-tauri/icons/android`의 Ginote 아이콘으로 덮었습니다.

### 확인한 것 (2026-10-03, 에뮬레이터 Pixel Fold API 35)

- 내장 번들로 실행, 실제 `note.gitools.net`에서 OTA로 받아 다음 실행에 적용
- 출처 `http://tauri.localhost`, 보안 컨텍스트, `api.openai.com`·`api.github.com` CORS 통과
- 마이크 권한 창 → 허용 → `getUserMedia` 오디오 트랙 `live`
- 상태 바 겹침 없음, 테마에 따른 시스템 바 색, 키보드가 올라오면 화면 높이 축소
- 한 달 넘게 확인하지 못한 새 설치는 화면을 띄우기 전에 운영 빌드로 교체, 오프라인이면 바로
  내장본으로 실행

실기기와 스토어 서명·배포(업로드 keystore, Play Console)는 아직입니다.

## iOS

Xcode 본체가 필요해 아직 시작하지 않았습니다. `tauri ios init`, iOS용
`NSMicrophoneUsageDescription`, 시뮬레이터·실기기 확인, Apple Distribution 인증서와
프로비저닝 프로파일이 남아 있습니다.
