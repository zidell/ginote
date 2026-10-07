//! `ginote://` 링크를 받아 화면이 가져갈 때까지 모아 둔다(docs/DEEP_LINK.md).
//!
//! 셸은 링크를 해석하지 않는다. 링크의 뜻은 웹 빌드가 정하므로, 셸을 다시 배포하지 않고
//! 웹 배포만으로 링크 기능을 넓힐 수 있다.
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;

pub const SCHEME: &str = "ginote";
/// 새 링크가 쌓였다는 알림. 화면은 이 이벤트를 받거나 시작할 때 `deep_link_take`로 가져간다.
pub const EVENT: &str = "deep-link-received";

#[derive(Default)]
pub struct Pending(Mutex<Vec<String>>);

/// 다른 스킴이나 해석되지 않는 인자는 버린다. Windows·Linux에서는 링크가 실행 인자로 오기 때문이다.
fn accepts(url: &str) -> bool {
    url.split_once("://").is_some_and(|(scheme, _)| scheme.eq_ignore_ascii_case(SCHEME))
}

fn receive<R: Runtime>(app: &AppHandle<R>, urls: impl IntoIterator<Item = String>) {
    let urls: Vec<String> = urls.into_iter().filter(|url| accepts(url)).collect();
    if urls.is_empty() {
        return;
    }
    app.state::<Pending>().0.lock().unwrap().extend(urls);
    #[cfg(desktop)]
    focus_main(app);
    let _ = app.emit(EVENT, ());
}

#[cfg(desktop)]
pub fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn setup<R: Runtime>(app: &AppHandle<R>) {
    app.manage(Pending::default());
    // AppImage는 설치 과정이 없어 실행할 때 스킴을 등록한다. deb·rpm·NSIS·macOS 번들은 설치 때 등록된다.
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_some() {
        let _ = app.deep_link().register_all();
    }
    // 링크로 앱이 처음 켜졌으면 플러그인이 이미 받아 둔 것을 옮긴다. 이후 링크는 on_open_url로 온다.
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        receive(app, urls.into_iter().map(String::from));
    }
    let handle = app.clone();
    app.deep_link()
        .on_open_url(move |event| receive(&handle, event.urls().into_iter().map(String::from)));
}

/// 쌓인 링크를 받은 순서대로 넘기고 비운다.
#[tauri::command]
pub fn deep_link_take(pending: tauri::State<'_, Pending>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::accepts;

    #[test]
    fn accepts_only_ginote_links() {
        assert!(accepts("ginote://note/12"));
        assert!(accepts("GINOTE://open"));
        assert!(!accepts("https://github.com/zidell/ginote"));
        assert!(!accepts("ginote-note://x"));
        assert!(!accepts("--version"));
    }
}
