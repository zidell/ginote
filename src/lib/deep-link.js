import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

// 앱이 받은 ginote:// 링크를 받은 순서대로 onLink(url)에 넘긴다(docs/DEEP_LINK.md).
// 셸은 링크를 해석하지 않고 쌓아 두기만 하므로, 시작할 때 쌓인 것을 가져오고 이후에는
// deep-link-received 알림이 올 때마다 다시 가져온다. 웹 브라우저나 deep_link_take가 없는
// 옛 셸(NATIVE_API 3 미만)에서는 아무것도 하지 않는다.
export function watchDeepLinks(onLink, {
  invoke = tauriInvoke,
  listen = tauriListen,
  isTauri = Boolean(globalThis.__TAURI_INTERNALS__)
} = {}) {
  if (!isTauri) return () => {};
  let stopped = false;
  let unlisten;

  const take = () => invoke('deep_link_take')
    .then((urls) => {
      if (stopped) return;
      for (const url of urls || []) onLink(url);
    })
    .catch(() => {});

  listen('deep-link-received', take)
    .then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    })
    .catch(() => {});
  take();

  return () => {
    stopped = true;
    unlisten?.();
  };
}
