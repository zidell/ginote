import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

// 앱의 네이티브 셸이 오래돼 새 웹 빌드를 받지 못할 때 한 번 알린다(docs/APP_OTA.md).
// 셸은 실행 직후 백그라운드에서 확인하므로, 이미 끝난 결과는 ota_status로, 나중에 끝나는
// 결과는 ota-status 이벤트로 받는다. 웹 브라우저에서는 아무것도 하지 않는다.
export function watchAppUpdate(onUpdateRequired, {
  invoke = tauriInvoke,
  listen = tauriListen,
  isTauri = Boolean(globalThis.__TAURI_INTERNALS__)
} = {}) {
  if (!isTauri) return () => {};
  let notified = false;
  let stopped = false;
  let unlisten;

  const handle = (status) => {
    if (stopped || notified || !status?.updateRequired) return;
    notified = true;
    onUpdateRequired();
  };

  listen('ota-status', (event) => handle(event.payload))
    .then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    })
    .catch(() => {});
  invoke('ota_status').then(handle).catch(() => {});

  return () => {
    stopped = true;
    unlisten?.();
  };
}
