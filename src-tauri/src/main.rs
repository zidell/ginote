// Windows 릴리스 빌드는 GUI 앱이라 실행할 때 콘솔 창을 띄우지 않는다. 명령줄 출력은
// settings::handle_cli가 부모 콘솔에 붙어 내보낸다.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ginote_lib::run();
}
