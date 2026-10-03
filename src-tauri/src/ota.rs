//! 앱 프론트엔드 자동 교체(OTA). 설계와 규약은 docs/APP_OTA.md에 있다.
//!
//! 앱은 가지고 있는 번들(내려받은 번들, 없으면 설치 파일에 내장된 dist)로 바로 뜨고,
//! 백그라운드에서 note.gitools.net의 서명된 매니페스트를 확인해 새 빌드를 받아 둔다.
//! 받은 빌드는 다음 실행부터 쓴다. 롤백은 두지 않는다. 업데이트 확인을 JS가 아니라
//! 여기서 하므로, 프론트엔드가 죽는 빌드가 나가도 고친 빌드를 재배포하면 복구된다.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use base64::Engine;
use ring::digest::{digest, SHA256};
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{App, Assets, Emitter, Manager, Runtime};

/// 이 셸이 프론트엔드에 제공하는 네이티브 API 수준. src/lib/native-api.js의
/// MIN_NATIVE_API와 짝을 이룬다. command·플러그인·권한을 늘릴 때만 올린다.
pub const NATIVE_API: u32 = 1;

/// 웹 빌드를 받아 올 주소. 포크나 로컬 시험에서는 빌드할 때 GINOTE_OTA_BASE_URL로 바꾼다.
const BASE_URL: &str = match option_env!("GINOTE_OTA_BASE_URL") {
    Some(url) => url,
    None => "https://note.gitools.net/",
};
const MANIFEST_FILE: &str = "app-manifest.json";
const SIGNATURE_FILE: &str = "app-manifest.json.sig";
const MANIFEST_FORMAT: u32 = 1;

/// scripts/generate-ota-key.mjs로 만든 Ed25519 공개키. 개인키는 웹 빌드 환경의
/// GINOTE_OTA_SIGNING_KEY 시크릿에만 있다. 포크는 자기 키로 GINOTE_OTA_PUBLIC_KEY를 준다.
const OTA_PUBLIC_KEY: &str = match option_env!("GINOTE_OTA_PUBLIC_KEY") {
    Some(key) => key,
    None => "4n/2KutVtUC3/BtI5JBV7nSd3zhzwJaTEnznxzjqCQM=",
};

const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_BUNDLE_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: u32,
    build: u64,
    min_native_api: u32,
    files: BTreeMap<String, FileEntry>,
}

#[derive(Debug, Deserialize)]
struct FileEntry {
    sha256: String,
    size: u64,
}

/// 매니페스트 서명을 검증하고 해석한다. 서명은 매니페스트 바이트 그대로에 대한 것이다.
fn verify_manifest(
    bytes: &[u8],
    signature_base64: &str,
    public_key: &[u8],
) -> Result<Manifest, String> {
    let engine = base64::engine::general_purpose::STANDARD;
    let signature = engine
        .decode(signature_base64.trim())
        .map_err(|e| format!("서명 형식 오류: {e}"))?;
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(bytes, &signature)
        .map_err(|_| "매니페스트 서명이 맞지 않습니다".to_string())?;
    let manifest: Manifest =
        serde_json::from_slice(bytes).map_err(|e| format!("매니페스트 해석 오류: {e}"))?;
    if manifest.format != MANIFEST_FORMAT {
        return Err(format!(
            "지원하지 않는 매니페스트 형식: {}",
            manifest.format
        ));
    }
    if !manifest.files.contains_key("index.html") {
        return Err("매니페스트에 index.html이 없습니다".into());
    }
    let mut total = 0u64;
    for (path, entry) in &manifest.files {
        if !is_safe_path(path) {
            return Err(format!("허용하지 않는 경로: {path}"));
        }
        if entry.size > MAX_FILE_BYTES {
            return Err(format!("파일이 너무 큽니다: {path}"));
        }
        total += entry.size;
    }
    if total > MAX_BUNDLE_BYTES {
        return Err("번들이 너무 큽니다".into());
    }
    Ok(manifest)
}

/// 번들 폴더 밖으로 나갈 수 없는 상대 경로만 받는다.
fn is_safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != ".." && !part.starts_with('.'))
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex(digest(&SHA256, bytes).as_ref())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn matches_entry(bytes: &[u8], entry: &FileEntry) -> bool {
    bytes.len() as u64 == entry.size && sha256_hex(bytes) == entry.sha256
}

#[derive(Debug, PartialEq, Eq)]
enum Decision {
    Download,
    UpToDate,
    NeedsNativeUpdate,
}

fn decide(manifest: &Manifest, current_build: u64) -> Decision {
    if manifest.build <= current_build {
        Decision::UpToDate
    } else if manifest.min_native_api > NATIVE_API {
        Decision::NeedsNativeUpdate
    } else {
        Decision::Download
    }
}

/// index.html 안의 인라인 <script>·<style> 내용의 CSP 해시. Tauri는 내장 자산의 해시를
/// 컴파일할 때 계산하므로, 내려받은 index.html은 여기서 다시 계산해 넘겨야 한다.
fn inline_csp_hashes(html: &str) -> Vec<(bool, String)> {
    let engine = base64::engine::general_purpose::STANDARD;
    let mut hashes = Vec::new();
    for (tag, is_script) in [("script", true), ("style", false)] {
        let open = format!("<{tag}");
        let close = format!("</{tag}>");
        let mut rest = html;
        while let Some(start) = rest.find(&open) {
            let after = &rest[start..];
            let Some(tag_end) = after.find('>') else {
                break;
            };
            let attrs = &after[open.len()..tag_end];
            let body = &after[tag_end + 1..];
            let Some(body_end) = body.find(&close) else {
                break;
            };
            let content = &body[..body_end];
            if !(is_script && attrs.contains("src=")) && !content.is_empty() {
                let hash = engine.encode(digest(&SHA256, content.as_bytes()).as_ref());
                hashes.push((is_script, format!("'sha256-{hash}'")));
            }
            rest = &body[body_end + close.len()..];
        }
    }
    hashes
}

struct ActiveBundle {
    dir: PathBuf,
    csp_hashes: Vec<(bool, String)>,
}

/// 프론트엔드에 알려 주는 상태. ota_status command와 `ota-status` 이벤트로 나간다.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtaStatus {
    build: u64,
    native_api: u32,
    update_required: bool,
    staged_build: Option<u64>,
}

#[derive(Default)]
pub struct OtaState {
    build: AtomicU64,
    update_required: AtomicBool,
    staged_build: AtomicU64,
}

impl OtaState {
    fn snapshot(&self) -> OtaStatus {
        let staged = self.staged_build.load(Ordering::Relaxed);
        OtaStatus {
            build: self.build.load(Ordering::Relaxed),
            native_api: NATIVE_API,
            update_required: self.update_required.load(Ordering::Relaxed),
            staged_build: (staged != 0).then_some(staged),
        }
    }
}

#[tauri::command]
pub fn ota_status(state: tauri::State<'_, Arc<OtaState>>) -> OtaStatus {
    state.snapshot()
}

/// 내장 자산 앞에 내려받은 번들을 두는 자산 제공자.
pub struct OtaAssets<R: Runtime> {
    embedded: Arc<dyn Assets<R>>,
    active: OnceLock<Option<ActiveBundle>>,
}

impl<R: Runtime> OtaAssets<R> {
    pub fn new(embedded: Box<dyn Assets<R>>) -> Self {
        Self {
            embedded: Arc::from(embedded),
            active: OnceLock::new(),
        }
    }

    fn active(&self) -> Option<&ActiveBundle> {
        // setup보다 먼저 자산 요청이 오면 이번 실행은 내장본으로 고정한다. 번들이 섞이지 않게 한다.
        self.active.get_or_init(|| None).as_ref()
    }
}

fn embedded_build<R: Runtime>(embedded: &dyn Assets<R>) -> u64 {
    embedded
        .get(&AssetKey::from(MANIFEST_FILE))
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| value.get("build")?.as_u64())
        .unwrap_or(0)
}

/// `current`가 가리키는 번들을 고르고 나머지 번들과 임시 폴더를 지운다.
fn select_bundle(root: &Path, embedded_build: u64) -> Option<(u64, ActiveBundle)> {
    let current = fs::read_to_string(root.join("current"))
        .ok()?
        .trim()
        .parse::<u64>()
        .ok();
    let _ = fs::remove_dir_all(root.join("tmp"));
    let chosen = current
        .filter(|build| *build > embedded_build)
        .and_then(|build| {
            let dir = root.join("bundles").join(build.to_string());
            let html = fs::read_to_string(dir.join("index.html")).ok()?;
            Some((
                build,
                ActiveBundle {
                    csp_hashes: inline_csp_hashes(&html),
                    dir,
                },
            ))
        });
    if let Ok(entries) = fs::read_dir(root.join("bundles")) {
        for entry in entries.flatten() {
            let keep = chosen
                .as_ref()
                .is_some_and(|(_, bundle)| bundle.dir == entry.path());
            if !keep {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
    if chosen.is_none() {
        let _ = fs::remove_file(root.join("current"));
    }
    chosen
}

impl<R: Runtime> Assets<R> for OtaAssets<R> {
    fn setup(&self, app: &App<R>) {
        let state = Arc::new(OtaState::default());
        app.manage(state.clone());
        let embedded_build = embedded_build(self.embedded.as_ref());
        state.build.store(embedded_build, Ordering::Relaxed);

        // 개발 모드는 Vite 개발 서버를 열므로 번들을 쓰지도 받지도 않는다.
        if tauri::is_dev() {
            return;
        }
        let Ok(root) = app.path().app_local_data_dir().map(|dir| dir.join("ota")) else {
            return;
        };
        let selected = select_bundle(&root, embedded_build);
        let (build, active_dir) = match selected {
            Some((build, bundle)) => {
                let dir = bundle.dir.clone();
                if self.active.set(Some(bundle)).is_ok() {
                    (build, Some(dir))
                } else {
                    (embedded_build, None)
                }
            }
            None => {
                let _ = self.active.set(None);
                (embedded_build, None)
            }
        };
        state.build.store(build, Ordering::Relaxed);

        let embedded = self.embedded.clone();
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            let result = check_for_update(
                &root,
                build,
                active_dir.as_deref(),
                embedded.as_ref(),
                &state,
            );
            if let Err(error) = result {
                eprintln!("OTA 업데이트 확인 실패: {error}");
            }
            let _ = handle.emit("ota-status", state.snapshot());
        });
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        if let Some(bundle) = self.active() {
            let path = key.as_ref().trim_start_matches('/');
            if is_safe_path(path) {
                if let Ok(bytes) = fs::read(bundle.dir.join(path)) {
                    return Some(Cow::Owned(bytes));
                }
            }
        }
        self.embedded.get(key)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.embedded.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        match self.active() {
            Some(bundle) if html_path.as_ref().trim_start_matches('/') == "index.html" => {
                Box::new(bundle.csp_hashes.iter().map(|(is_script, hash)| {
                    if *is_script {
                        CspHash::Script(hash.as_str())
                    } else {
                        CspHash::Style(hash.as_str())
                    }
                }))
            }
            _ => self.embedded.csp_hashes(html_path),
        }
    }
}

fn fetch(agent: &ureq::Agent, path: &str, limit: u64) -> Result<Vec<u8>, String> {
    let url = format!("{BASE_URL}{path}");
    let response = agent.get(&url).call().map_err(|e| format!("{url}: {e}"))?;
    let mut bytes = Vec::new();
    response
        .into_body()
        .into_reader()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("{url}: {e}"))?;
    if bytes.len() as u64 > limit {
        return Err(format!("{url}: 크기 제한 초과"));
    }
    Ok(bytes)
}

fn check_for_update<R: Runtime>(
    root: &Path,
    current_build: u64,
    active_dir: Option<&Path>,
    embedded: &dyn Assets<R>,
    state: &OtaState,
) -> Result<(), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(120)))
        .build()
        .into();
    let manifest_bytes = fetch(&agent, MANIFEST_FILE, MAX_MANIFEST_BYTES)?;
    let signature = fetch(&agent, SIGNATURE_FILE, 1024)?;
    let public_key = base64::engine::general_purpose::STANDARD
        .decode(OTA_PUBLIC_KEY)
        .map_err(|e| e.to_string())?;
    let manifest = verify_manifest(
        &manifest_bytes,
        &String::from_utf8_lossy(&signature),
        &public_key,
    )?;

    match decide(&manifest, current_build) {
        Decision::UpToDate => return Ok(()),
        Decision::NeedsNativeUpdate => {
            state.update_required.store(true, Ordering::Relaxed);
            return Ok(());
        }
        Decision::Download => {}
    }

    let tmp = root.join("tmp").join(manifest.build.to_string());
    let _ = fs::remove_dir_all(&tmp);
    for (path, entry) in &manifest.files {
        // 지금 번들이나 내장본에 같은 내용이 있으면 다시 받지 않는다.
        let local = active_dir
            .and_then(|dir| fs::read(dir.join(path)).ok())
            .filter(|bytes| matches_entry(bytes, entry))
            .or_else(|| {
                embedded
                    .get(&AssetKey::from(path.as_str()))
                    .map(Cow::into_owned)
                    .filter(|bytes| matches_entry(bytes, entry))
            });
        let bytes = match local {
            Some(bytes) => bytes,
            None => {
                let bytes = fetch(&agent, path, entry.size)?;
                if !matches_entry(&bytes, entry) {
                    let _ = fs::remove_dir_all(&tmp);
                    return Err(format!("{path}: 해시가 맞지 않습니다"));
                }
                bytes
            }
        };
        let target = tmp.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&target, bytes).map_err(|e| e.to_string())?;
    }
    fs::write(tmp.join(MANIFEST_FILE), &manifest_bytes).map_err(|e| e.to_string())?;

    let bundles = root.join("bundles");
    fs::create_dir_all(&bundles).map_err(|e| e.to_string())?;
    let target = bundles.join(manifest.build.to_string());
    let _ = fs::remove_dir_all(&target);
    fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    let pointer = root.join("current.tmp");
    fs::write(&pointer, manifest.build.to_string()).map_err(|e| e.to_string())?;
    fs::rename(&pointer, root.join("current")).map_err(|e| e.to_string())?;
    state.staged_build.store(manifest.build, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::rand::SystemRandom;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    fn keypair() -> Ed25519KeyPair {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap()
    }

    fn signed(pair: &Ed25519KeyPair, json: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(pair.sign(json.as_bytes()).as_ref())
    }

    const MANIFEST: &str = r#"{"format":1,"build":200,"minNativeApi":1,"files":{"index.html":{"sha256":"ab","size":2}}}"#;

    /// 실제 웹 빌드(Node 서명)를 앱의 공개키로 검증한다.
    /// GINOTE_OTA_DIST=../dist cargo test -- --ignored built_manifest
    #[test]
    #[ignore]
    fn verifies_built_manifest_with_app_key() {
        let dist = PathBuf::from(std::env::var("GINOTE_OTA_DIST").unwrap());
        let bytes = fs::read(dist.join(MANIFEST_FILE)).unwrap();
        let signature = fs::read_to_string(dist.join(SIGNATURE_FILE)).unwrap();
        let key = base64::engine::general_purpose::STANDARD
            .decode(OTA_PUBLIC_KEY)
            .unwrap();
        let manifest = verify_manifest(&bytes, &signature, &key).unwrap();
        for (path, entry) in &manifest.files {
            assert!(
                matches_entry(&fs::read(dist.join(path)).unwrap(), entry),
                "{path}"
            );
        }
    }

    #[test]
    fn accepts_correctly_signed_manifest() {
        let pair = keypair();
        let manifest = verify_manifest(
            MANIFEST.as_bytes(),
            &signed(&pair, MANIFEST),
            pair.public_key().as_ref(),
        )
        .unwrap();
        assert_eq!(manifest.build, 200);
    }

    #[test]
    fn rejects_tampered_manifest_or_wrong_key() {
        let pair = keypair();
        let signature = signed(&pair, MANIFEST);
        let tampered = MANIFEST.replace("200", "201");
        assert!(
            verify_manifest(tampered.as_bytes(), &signature, pair.public_key().as_ref()).is_err()
        );
        assert!(verify_manifest(
            MANIFEST.as_bytes(),
            &signature,
            keypair().public_key().as_ref()
        )
        .is_err());
    }

    #[test]
    fn rejects_paths_outside_bundle() {
        let pair = keypair();
        for path in [
            "../x",
            "/etc/x",
            "a/../../x",
            "a\\b",
            "C:x",
            ".hidden",
            "a//b",
        ] {
            let json = MANIFEST.replace(
                "index.html\":{",
                &format!(
                    "index.html\":{{\"sha256\":\"ab\",\"size\":2}},\"{}\":{{",
                    path.replace('\\', "\\\\")
                ),
            );
            assert!(
                verify_manifest(
                    json.as_bytes(),
                    &signed(&pair, &json),
                    pair.public_key().as_ref()
                )
                .is_err(),
                "{path}"
            );
        }
    }

    #[test]
    fn decides_by_build_and_native_api() {
        let manifest = |build, min_native_api| Manifest {
            format: 1,
            build,
            min_native_api,
            files: BTreeMap::new(),
        };
        assert_eq!(decide(&manifest(200, 1), 100), Decision::Download);
        assert_eq!(decide(&manifest(100, 1), 100), Decision::UpToDate);
        assert_eq!(decide(&manifest(50, 1), 100), Decision::UpToDate);
        assert_eq!(
            decide(&manifest(200, NATIVE_API + 1), 100),
            Decision::NeedsNativeUpdate
        );
    }

    #[test]
    fn verifies_file_hash_and_size() {
        let entry = FileEntry {
            sha256: sha256_hex(b"hi"),
            size: 2,
        };
        assert!(matches_entry(b"hi", &entry));
        assert!(!matches_entry(b"ho", &entry));
        assert!(!matches_entry(
            b"hi!",
            &FileEntry {
                sha256: entry.sha256.clone(),
                size: 3
            }
        ));
    }

    #[test]
    fn hashes_inline_blocks_but_not_external_scripts() {
        let html = r#"<style>a{}</style><script type="application/ld+json">{}</script><script type="module" src="./x.js"></script>"#;
        let hashes = inline_csp_hashes(html);
        assert_eq!(hashes.len(), 2);
        assert!(hashes.iter().any(|(is_script, _)| *is_script));
        assert!(hashes.iter().any(|(is_script, _)| !*is_script));
    }

    #[test]
    fn selects_only_newer_downloaded_bundle_and_cleans_others() {
        let root = std::env::temp_dir().join(format!("ginote-ota-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for build in ["100", "300"] {
            fs::create_dir_all(root.join("bundles").join(build)).unwrap();
            fs::write(
                root.join("bundles").join(build).join("index.html"),
                "<html>",
            )
            .unwrap();
        }
        fs::create_dir_all(root.join("tmp/400")).unwrap();
        fs::write(root.join("current"), "300").unwrap();

        let (build, _) = select_bundle(&root, 200).unwrap();
        assert_eq!(build, 300);
        assert!(!root.join("bundles/100").exists());
        assert!(!root.join("tmp").exists());

        // 스토어 업데이트로 내장본이 더 새것이면 내려받은 번들을 버린다.
        assert!(select_bundle(&root, 300).is_none());
        assert!(!root.join("bundles/300").exists());
        assert!(!root.join("current").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
