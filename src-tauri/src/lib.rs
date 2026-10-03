mod ota;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    // 내장 dist 앞에 내려받은 프론트엔드 번들을 둔다(docs/APP_OTA.md).
    let embedded = context.set_assets(Box::new(EmptyAssets));
    context.set_assets(Box::new(ota::OtaAssets::new(embedded)));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![ota::ota_status])
        .run(context)
        .expect("error while running Ginote");
}

/// set_assets로 내장 자산을 꺼내는 동안만 잠깐 끼워 두는 빈 제공자.
struct EmptyAssets;

impl<R: tauri::Runtime> tauri::Assets<R> for EmptyAssets {
    fn get(&self, _: &tauri::utils::assets::AssetKey) -> Option<std::borrow::Cow<'_, [u8]>> {
        None
    }

    fn iter(&self) -> Box<tauri::utils::assets::AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }

    fn csp_hashes(
        &self,
        _: &tauri::utils::assets::AssetKey,
    ) -> Box<dyn Iterator<Item = tauri::utils::assets::CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}
