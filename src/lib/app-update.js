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

// 화면을 띄우기 전에 부른다. 셸이 한 달 넘게 업데이트를 확인하지 못한 상태(stale)라고 하면
// onWaiting을 부르고, 새 빌드를 받아 적용했는지(true면 새로고침해야 함)를 돌려준다.
// 웹 브라우저나 이 command가 없는 셸, 오류가 나면 false로 그대로 띄운다.
export async function prepareAppUpdate({
  invoke = tauriInvoke,
  isTauri = Boolean(globalThis.__TAURI_INTERNALS__),
  onWaiting = () => {}
} = {}) {
  if (!isTauri) return false;
  try {
    const status = await invoke('ota_status');
    if (!status?.stale) return false;
    onWaiting();
    return (await invoke('ota_prepare')) === true;
  } catch {
    return false;
  }
}
