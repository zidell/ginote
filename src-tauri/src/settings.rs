//! 설치형 앱의 환경설정 파일과 자격 증명 저장소(docs/CONFIG.md).
//!
//! - 일반 설정은 앱 설정 폴더의 config.toml에 둔다. 사람과 에이전트가 직접 읽고 고칠 수 있도록
//!   내용(주석 포함)은 프론트엔드(src/lib/app-config.js)가 스키마에서 만들고, 여기서는 파일을
//!   원자적으로 읽고 쓰기만 한다.
//! - PAT·OpenAI 키 같은 자격 증명은 config.toml에 두지 않고 OS 자격 증명 저장소에 둔다.
//!   macOS·iOS 키체인, Windows 자격 증명 관리자, Linux Secret Service, Android Keystore.
//! - 데스크톱에서는 config.toml이 바깥에서 바뀌면 settings-file-changed 이벤트로 알린다.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

pub const CONFIG_FILE: &str = "config.toml";
/// 앱이 config.toml을 마지막으로 읽은 결과. 에이전트가 고친 값이 반영됐는지 여기서 확인한다.
pub const STATUS_FILE: &str = "config-status.txt";
const SECRET_SERVICE: &str = "net.gitools.note";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFile {
    path: String,
    /// 파일이 아직 없으면 None(처음 실행).
    text: Option<String>,
}

fn config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn settings_read<R: Runtime>(app: AppHandle<R>) -> Result<ConfigFile, String> {
    let path = config_dir(&app)?.join(CONFIG_FILE);
    let text = match fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    Ok(ConfigFile { path: path.to_string_lossy().into_owned(), text })
}

#[tauri::command(async)]
pub fn settings_write<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), String> {
    write_atomic(&config_dir(&app)?.join(CONFIG_FILE), &text).map_err(|error| error.to_string())
}

/// 마지막으로 읽은 결과를 config-status.txt에 남긴다. 값 오류가 있으면 항목·이유·적용한 값을 적는다.
#[tauri::command(async)]
pub fn settings_report<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), String> {
    write_atomic(&config_dir(&app)?.join(STATUS_FILE), &text).map_err(|error| error.to_string())
}

/// 같은 폴더의 임시 파일에 다 쓴 뒤 이름을 바꿔, 읽는 쪽이 반쯤 쓴 파일을 보지 않게 한다.
fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| std::io::Error::other("no parent directory"))?;
    fs::create_dir_all(dir)?;
    let temp = dir.join(format!(
        ".{}.tmp",
        path.file_name().and_then(|name| name.to_str()).unwrap_or("settings")
    ));
    {
        let mut file = fs::File::create(&temp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&temp, path)
}

// --- 자격 증명 -------------------------------------------------------------------------

fn secret_store() -> Result<(), String> {
    static READY: OnceLock<Result<(), String>> = OnceLock::new();
    READY
        .get_or_init(|| {
            #[cfg(target_os = "macos")]
            let store = apple_native_keyring_store::keychain::Store::new();
            #[cfg(target_os = "ios")]
            let store = apple_native_keyring_store::protected::Store::new();
            #[cfg(target_os = "windows")]
            let store = windows_native_keyring_store::Store::new();
            #[cfg(target_os = "linux")]
            let store = zbus_secret_service_keyring_store::Store::new();
            #[cfg(target_os = "android")]
            let store = android_native_keyring_store::Store::new();
            let store = store.map_err(|error| error.to_string())?;
            keyring_core::set_default_store(store);
            Ok(())
        })
        .clone()
}

/// 자격 증명 이름은 앱이 정한 것만 쓴다(github-pat:<워크스페이스 id>, openai-api-key).
fn secret_entry(name: &str) -> Result<keyring_core::Entry, String> {
    let valid = !name.is_empty()
        && name.len() <= 100
        && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"-:_".contains(&byte));
    if !valid {
        return Err("invalid secret name".into());
    }
    secret_store()?;
    keyring_core::Entry::new(SECRET_SERVICE, name).map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
    match secret_entry(&name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command(async)]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    secret_entry(&name)?.set_password(&value).map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn secret_delete(name: String) -> Result<(), String> {
    match secret_entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

// --- 바깥 변경 감지(데스크톱) ---------------------------------------------------------------

/// config.toml의 수정 시각·크기를 1초마다 보고, 바뀌면 settings-file-changed를 보낸다.
/// 앱이 직접 쓴 변경도 이벤트가 가지만, 프론트엔드가 마지막으로 쓴 내용과 같으면 무시한다.
#[cfg(desktop)]
pub fn watch<R: Runtime>(app: &AppHandle<R>) {
    use std::time::Duration;
    use tauri::Emitter;

    let Ok(path) = config_dir(app).map(|dir| dir.join(CONFIG_FILE)) else {
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let stamp = |path: &Path| fs::metadata(path).ok().map(|meta| (meta.modified().ok(), meta.len()));
        let mut last = stamp(&path);
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let current = stamp(&path);
            if current != last {
                last = current;
                let _ = app.emit("settings-file-changed", ());
            }
        }
    });
}

// --- 명령줄 ---------------------------------------------------------------------------------

/// GUI를 띄우기 전에 --help·--config-path를 처리한다. 처리했으면 true(바로 종료).
#[cfg(desktop)]
pub fn handle_cli(identifier: &str, version: &str) -> bool {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let config_dir = || dirs::config_dir().map(|dir| dir.join(identifier));
    if args.iter().any(|arg| arg == "--config-path") {
        match config_dir() {
            Some(dir) => println!("{}", dir.join(CONFIG_FILE).display()),
            None => {
                eprintln!("Ginote: could not determine the user configuration directory");
                std::process::exit(1);
            }
        }
        return true;
    }
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        let path = config_dir()
            .map(|dir| dir.join(CONFIG_FILE).display().to_string())
            .unwrap_or_else(|| "(unknown)".into());
        print!("{}", cli_help(version, &path));
        return true;
    }
    false
}

#[cfg(desktop)]
fn cli_help(version: &str, config_path: &str) -> String {
    format!(
        "Ginote {version}\n\
         \n\
         Usage: ginote [--help | --config-path]\n\
         \n\
         Options:\n\
         \x20 --config-path  Print the absolute path of the active settings file and exit.\n\
         \x20                The file may not exist yet; Ginote creates it on first launch.\n\
         \x20 -h, --help     Print this help and exit.\n\
         \n\
         Settings file: {config_path}\n\
         \x20 TOML with a comment above every key (meaning, type, allowed values, default).\n\
         \x20 Edit it while Ginote is running or not; a running Ginote applies changes within\n\
         \x20 about a second. After editing, read {status} in the same folder:\n\
         \x20 it records when Ginote last loaded the file and any rejected values.\n\
         \x20 GitHub tokens and the OpenAI API key are not in this file; they live in the\n\
         \x20 operating system's credential store and can only be set in the app.\n\
         \n\
         The same guide ships with the app as readme.txt.\n",
        status = STATUS_FILE,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_atomic_creates_the_folder_and_replaces_the_file() {
        let dir = std::env::temp_dir().join(format!("ginote-settings-{}", std::process::id()));
        let path = dir.join("nested").join(CONFIG_FILE);
        write_atomic(&path, "a = 1\n").unwrap();
        write_atomic(&path, "a = 2\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "a = 2\n");
        assert!(!dir.join("nested").join(".config.toml.tmp").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn secret_names_are_restricted() {
        assert!(secret_entry("").is_err());
        assert!(secret_entry("../x").is_err());
        assert!(secret_entry("a b").is_err());
    }

    /// 실제 OS 자격 증명 저장소를 쓴다. `cargo test --lib -- --ignored secret_round_trip`으로 직접 돌린다.
    #[test]
    #[ignore]
    fn secret_round_trip() {
        let name = "ginote-test-round-trip".to_string();
        secret_delete(name.clone()).unwrap();
        assert_eq!(secret_get(name.clone()).unwrap(), None);
        secret_set(name.clone(), "value-1".into()).unwrap();
        secret_set(name.clone(), "value-2".into()).unwrap();
        assert_eq!(secret_get(name.clone()).unwrap().as_deref(), Some("value-2"));
        secret_delete(name.clone()).unwrap();
        assert_eq!(secret_get(name).unwrap(), None);
    }

    #[cfg(desktop)]
    #[test]
    fn help_points_at_the_settings_and_status_files() {
        let help = cli_help("0.1.9", "/tmp/net.gitools.note/config.toml");
        assert!(help.starts_with("Ginote 0.1.9\n"));
        assert!(help.contains("/tmp/net.gitools.note/config.toml"));
        assert!(help.contains(STATUS_FILE));
        assert!(help.contains("--config-path"));
    }
}
