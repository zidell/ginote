import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog';
import { translate } from './i18n.js';

// 확인창. iOS·macOS의 Tauri WebView(wry의 WKWebView)는 window.confirm 창을 띄우지 않고 바로
// false를 돌려주므로, 앱 안에서는 Tauri 대화상자 플러그인의 네이티브 확인창을 쓴다. 웹은
// 브라우저 confirm을 그대로 쓴다. 두 경우 모두 Promise<boolean>을 돌려준다.
export async function confirmAction(message, {
  isTauri = Boolean(globalThis.__TAURI_INTERNALS__),
  nativeConfirm = tauriConfirm
} = {}) {
  if (!isTauri) return globalThis.confirm(message);
  try {
    return await nativeConfirm(message, {
      title: 'Ginote',
      kind: 'warning',
      okLabel: translate('dynamic.dialogOk'),
      cancelLabel: translate('dynamic.dialogCancel')
    });
  } catch {
    return false;
  }
}

// 이미 설치된 앱 안인지. 브라우저·공용 PC에만 필요한 안내를 앱에서는 생략할 때 쓴다.
export function isInstalledApp() {
  return Boolean(globalThis.__TAURI_INTERNALS__);
}
