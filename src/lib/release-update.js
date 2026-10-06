import { getVersion as tauriGetVersion } from '@tauri-apps/api/app';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { check as tauriCheck } from '@tauri-apps/plugin-updater';
import { installedSnapshot, updateInstalledSnapshot } from './installed-settings.js';

// 앱 자체 업데이트(src-tauri/src/release_update.rs, docs/DESKTOP.md). 웹 빌드 교체(app-update.js)와 달리
// 설치된 앱을 새 릴리스로 바꾼다. 데스크톱은 스스로 확인하고 모바일은 스토어가 맡는다.
// 확인 여부와 건너뛴 버전은 config.toml의 [updates]에 둔다.

export const FIRST_CHECK_DELAY_MS = 10 * 1000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const DEFAULT_PREFERENCES = { checkAutomatically: true, skippedVersion: '' };

export async function releaseUpdateSupported({
  invoke = tauriInvoke,
  isTauri = Boolean(globalThis.__TAURI_INTERNALS__)
} = {}) {
  if (!isTauri) return false;
  try {
    return (await invoke('release_update_supported')) === true;
  } catch {
    return false;
  }
}

export function loadReleaseUpdatePreferences() {
  return { ...DEFAULT_PREFERENCES, ...installedSnapshot()?.updates };
}

export function saveReleaseUpdatePreferences(patch) {
  updateInstalledSnapshot((snapshot) => {
    snapshot.updates = { ...DEFAULT_PREFERENCES, ...snapshot.updates, ...patch };
  });
}

export function currentAppVersion({ getVersion = tauriGetVersion } = {}) {
  return getVersion();
}

// 새 릴리스가 있으면 업데이트 객체를, 없으면 null을 돌려준다. 자동 확인에서는 사용자가 건너뛴
// 버전을 다시 권하지 않고, 사용자가 직접 확인할 때는 건너뛴 버전도 보여 준다.
export async function findReleaseUpdate({ manual = false, check = tauriCheck } = {}) {
  const update = await check();
  if (!update) return null;
  if (!manual && update.version === loadReleaseUpdatePreferences().skippedVersion) return null;
  return update;
}

// 실행 직후 잠시 뒤와 그 뒤 6시간마다 확인한다. 확인 시점마다 설정을 다시 읽으므로 config.toml이나
// 설정 화면에서 자동 확인을 끄면 다음 차례부터 확인하지 않는다.
export function watchReleaseUpdates(onUpdate, {
  supported = releaseUpdateSupported,
  find = findReleaseUpdate,
  timers = globalThis
} = {}) {
  let stopped = false;
  let interval;
  const run = async () => {
    if (stopped || !loadReleaseUpdatePreferences().checkAutomatically) return;
    try {
      const update = await find();
      if (update && !stopped) onUpdate(update);
    } catch {
      // 오프라인이거나 릴리스 서버에 닿지 못하면 다음 차례에 다시 확인한다.
    }
  };
  const first = timers.setTimeout(async () => {
    if (stopped || !(await supported())) return;
    void run();
    interval = timers.setInterval(run, CHECK_INTERVAL_MS);
  }, FIRST_CHECK_DELAY_MS);
  return () => {
    stopped = true;
    timers.clearTimeout(first);
    timers.clearInterval(interval);
  };
}

// 내려받아 설치한다. onProgress에는 0..1(전체 크기를 모르면 null)을 넘긴다.
export async function installReleaseUpdate(update, onProgress = () => {}) {
  let total = 0;
  let received = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data?.contentLength || 0;
      onProgress(total ? 0 : null);
    } else if (event.event === 'Progress') {
      received += event.data?.chunkLength || 0;
      onProgress(total ? Math.min(1, received / total) : null);
    } else if (event.event === 'Finished') {
      onProgress(1);
    }
  });
}

export function restartApp({ invoke = tauriInvoke } = {}) {
  return invoke('app_restart');
}
