# 딥링크 (`ginote://`)

설치형 앱은 `ginote://` 링크를 받을 준비가 되어 있습니다. 아직 링크로 하는 일은 없습니다. 링크를 누르면 앱이
열리거나 앞으로 오고, 받은 링크는 화면이 가져갈 때까지 쌓여 있습니다. 링크 형식과 동작은 기능을 붙일 때 정합니다.

## 왜 미리 두었나

스킴 등록과 링크 수신은 네이티브 셸에 들어가서 앱 업데이트를 거쳐야 퍼집니다. 화면 코드는 웹 빌드 교체
([APP_OTA](APP_OTA.md))로 바로 바뀝니다. 셸이 링크를 해석하지 않고 넘기기만 하므로, 링크 기능은 나중에 웹
배포만으로 켤 수 있습니다.

## 구조

| 곳 | 하는 일 |
| --- | --- |
| `src-tauri/tauri.conf.json`의 `plugins.deep-link` | 스킴 정의. 데스크톱 번들(macOS Info.plist, NSIS 레지스트리, deb·rpm `.desktop`)에 들어갑니다 |
| `src-tauri/src/deep_link.rs` | `ginote://` 링크만 골라 쌓고, 데스크톱에서는 메인 창을 앞으로 가져온 뒤 `deep-link-received` 이벤트를 보냅니다. `deep_link_take` command가 쌓인 링크를 넘기고 비웁니다 |
| `tauri-plugin-single-instance` (Windows·Linux) | 이 두 OS는 링크마다 앱을 새로 실행합니다. 이미 떠 있으면 새 실행을 끝내고 링크를 떠 있는 앱으로 넘깁니다 |
| AppImage | 설치 과정이 없어 실행할 때마다 스킴을 등록합니다(`register_all`) |
| `src/lib/deep-link.js`의 `watchDeepLinks(onLink)` | 화면 쪽 입구. 시작할 때 쌓인 링크를, 이후에는 이벤트가 올 때마다 가져와 받은 순서대로 넘깁니다. 웹 브라우저와 옛 셸에서는 아무것도 하지 않습니다 |
| Android `AndroidManifest.xml`, iOS `Info.plist` | `DEEP LINK PLUGIN` 블록과 `CFBundleURLTypes`. 플러그인 빌드 단계가 만드는 내용과 같게 커밋해 두었습니다. 모바일 빌드가 다시 써도 바뀌지 않습니다 |
| 맥 네이티브 앱(`macos/`) | `Ginote/Info.plist`에 같은 스킴을 등록하고, `AppDelegate.application(_:open:)`이 `AppModel.pendingDeepLinks`에 쌓은 뒤 메인 창을 앞으로 가져옵니다 |

## 기능을 붙일 때

1. 링크 형식을 정합니다. 화면 경로(`#!/note.12`)는 활성 저장소 안의 경로라서, 다른 저장소의 노트를 가리키려면 저장소도
   링크에 넣어야 합니다.
2. `App.svelte`에서 `watchDeepLinks`를 구독해 해석합니다. `deep_link_take`가 없는 옛 셸에서는 조용히 넘어가므로
   `MIN_NATIVE_API`를 올리지 않아도 됩니다. 링크가 없으면 안 되는 기능일 때만 올립니다.
3. 맥 네이티브 앱은 `AppModel.pendingDeepLinks`를 꺼내 같은 형식으로 해석합니다.

## 주의

- Tauri 앱과 맥 네이티브 앱이 같은 Mac에 있으면 둘 다 `ginote`를 등록하므로, 어느 앱이 열지는 macOS가 정합니다.
  특정 앱으로 열어 보려면 `open -b net.gitools.note 'ginote://…'`처럼 번들 ID를 지정합니다.
- macOS는 개발 모드(`tauri dev`)에서 링크를 받지 않습니다. 번들로 설치한 앱에서 확인합니다.
- `NATIVE_API`는 3부터 딥링크를 제공합니다.
