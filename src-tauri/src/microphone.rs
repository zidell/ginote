//! Linux의 WebKitGTK는 처리하지 않은 getUserMedia 요청을 묻지 않고 거부한다.
//! Tauri 2의 with_webview로 비동기 권한 창을 연결한다. GTK 메인 스레드를 막지 않는다.
use std::{cell::Cell, rc::Rc};

use gtk::prelude::*;
use tauri::{AppHandle, Manager, Url};
use webkit2gtk::{
    PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, UserMediaPermissionRequestExt,
    WebViewExt,
};

fn trusted_origin(uri: &str, dev_url: Option<&Url>) -> bool {
    let Ok(url) = Url::parse(uri) else {
        return false;
    };
    let bundled = matches!(url.scheme(), "tauri" | "http")
        && url.host_str()
            == Some(if url.scheme() == "tauri" {
                "localhost"
            } else {
                "tauri.localhost"
            })
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none();
    bundled || dev_url.is_some_and(|dev| url.origin() == dev.origin())
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let window = app.get_webview_window("main").expect("main webview");
    let parent_window = window.clone();
    let dev_url = if cfg!(debug_assertions) {
        app.config().build.dev_url.clone()
    } else {
        None
    };
    window.with_webview(move |platform| {
        let webview = platform.inner();
        let parent = parent_window.gtk_window().expect("main GTK window");
        if let Some(settings) = WebViewExt::settings(&webview) {
            settings.set_enable_media_stream(true);
        }
        let granted = Rc::new(Cell::new(false));
        webview.connect_permission_request(move |view, request| {
            let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() else {
                return false;
            };
            // 카메라·화면 공유와 외부 페이지에는 이 권한을 적용하지 않는다.
            if !media.is_for_audio_device()
                || media.is_for_video_device()
                || !view.uri().is_some_and(|uri| trusted_origin(&uri, dev_url.as_ref()))
            {
                request.deny();
                return true;
            }
            if granted.get() {
                request.allow();
                return true;
            }
            let dialog = gtk::MessageDialog::builder()
                .transient_for(&parent)
                .modal(true)
                .destroy_with_parent(true)
                .title("Ginote")
                .message_type(gtk::MessageType::Question)
                .text("Ginote에서 마이크를 사용하도록 허용하시겠습니까?")
                .secondary_text("음성 노트를 녹음할 때 사용합니다. 허용은 앱을 종료할 때까지 유지됩니다.")
                .build();
            dialog.add_button("거부", gtk::ResponseType::Cancel);
            dialog.add_button("허용", gtk::ResponseType::Accept);
            dialog.set_default_response(gtk::ResponseType::Cancel);
            let request = request.clone();
            let answered = Rc::new(Cell::new(false));
            let pending = request.clone();
            let responded = answered.clone();
            dialog.connect_destroy(move |_| {
                if !responded.replace(true) {
                    pending.deny();
                }
            });
            let view = view.clone();
            let granted = granted.clone();
            let dev_url = dev_url.clone();
            dialog.connect_response(move |dialog, response| {
                if answered.replace(true) {
                    return;
                }
                if response == gtk::ResponseType::Accept
                    && view.uri().is_some_and(|uri| trusted_origin(&uri, dev_url.as_ref()))
                {
                    granted.set(true);
                    request.allow();
                } else {
                    request.deny();
                }
                dialog.close();
            });
            dialog.show_all();
            true
        });
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_app_origins_can_request_microphone() {
        assert!(trusted_origin("tauri://localhost/index.html", None));
        assert!(trusted_origin("http://tauri.localhost/", None));
        for uri in [
            "https://example.com",
            "tauri://evil",
            "http://localhost:5173",
            "http://tauri.localhost.evil",
            "http://tauri.localhost:8080",
            "about:blank",
        ] {
            assert!(!trusted_origin(uri, None), "{uri}");
        }
        let dev = Url::parse("http://localhost:5173").unwrap();
        assert!(trusted_origin("http://localhost:5173/notes", Some(&dev)));
        assert!(!trusted_origin("http://localhost:5174", Some(&dev)));
    }
}
