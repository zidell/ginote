// 이 프론트엔드가 필요로 하는 앱 네이티브 API 수준이다. src-tauri/src/ota.rs 의 NATIVE_API와
// 짝을 이룬다. 프론트엔드가 새 Tauri command·플러그인·권한 없이는 동작하지 않을 때만 올린다
// (없는 command를 조용히 넘기는 딥링크는 올리지 않았다). 앱은 이 값이 자기 NATIVE_API보다 큰
// 웹 빌드를 받지 않는다(docs/APP_OTA.md).
export const MIN_NATIVE_API = 2;
