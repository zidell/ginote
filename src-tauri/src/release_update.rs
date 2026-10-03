//! 앱 자체(네이티브) 업데이트. 웹 빌드 교체(ota.rs)와 달리 설치된 앱 파일을 새 릴리스로 바꾼다.
//!
//! macOS·Linux는 Tauri 업데이터로 GitHub 릴리스의 latest.json을 확인하고, 화면에서 "지금 설치 /
//! 나중에 / 이 버전 건너뛰기"를 묻는다(src/lib/release-update.js). Windows는 Microsoft Store와
//! App Installer가 업데이트를 맡고, iOS·Android는 스토어가 맡으므로 여기서는 아무것도 하지 않는다.

use tauri::{AppHandle, Runtime};

/// macOS·Linux에서만 Tauri 업데이터 플러그인을 단다.
pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return builder.plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    builder
}

/// 이 앱이 스스로 새 릴리스를 받아 설치하는지. 아니면 스토어나 OS가 업데이트를 맡는다.
#[tauri::command]
pub fn release_update_supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "linux"))
}

/// 업데이트를 설치한 뒤 새 버전으로 다시 시작한다.
#[tauri::command]
pub fn app_restart<R: Runtime>(app: AppHandle<R>) {
    app.restart();
}
