import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import {
  ConfigSyntaxError,
  defaultSnapshot,
  parseConfig,
  renderConfig,
  renderStatus
} from './app-config.js';
import { installedSnapshot, useInstalledSnapshot } from './installed-settings.js';
import { STORAGE_KEY, loadSettingsDocument } from './settings-storage.js';
import { SIDEBAR_WIDTH_STORAGE_KEY, loadSidebarWidth } from './sidebar-width.js';
import { VOICE_SETTINGS_STORAGE_KEY, loadVoiceSettings } from './voice-settings.js';

// 설치형 앱의 설정 저장소(docs/CONFIG.md).
// - 일반 설정은 앱 설정 폴더의 config.toml(src-tauri/src/settings.rs)에 둔다.
// - PAT와 OpenAI 키는 OS 자격 증명 저장소에 둔다. 저장소를 쓸 수 없는 환경에서만
//   예전처럼 localStorage에 남긴다(FALLBACK_SECRETS_KEY).
// - 처음 실행하면 localStorage의 기존 설정을 옮기고 지운다.
// - 데스크톱에서는 바깥에서 고친 config.toml을 곧바로 다시 읽어 화면에 반영한다.

const PAT_SECRET_PREFIX = 'github-pat:';
const OPENAI_SECRET = 'openai-api-key';
const FALLBACK_SECRETS_KEY = 'issue-note.secrets-fallback.v1';
// 자격 증명을 뺀 마지막 정상 설정. 첫 화면 테마와, config.toml 문법이 깨졌을 때 되돌아갈 값이다.
export const LAST_GOOD_KEY = 'issue-note.installed-settings.v1';

export function createSettingsBackend({
  invoke = tauriInvoke,
  listen = tauriListen,
  storage = globalThis.localStorage,
  now = () => new Date(),
  createId = () => crypto.randomUUID()
} = {}) {
  let lastWrittenText = null;
  // 자격 증명 저장소에 실제로 들어 있다고 알고 있는 값(이름 → 값). 바뀐 것만 다시 쓴다.
  const storedSecrets = new Map();
  let queue = Promise.resolve();
  let persistQueued = false;
  const listeners = new Set();

  const enqueue = (task) => {
    queue = queue.then(task, task);
    return queue;
  };

  function readFallbackSecrets() {
    try {
      return JSON.parse(storage.getItem(FALLBACK_SECRETS_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function writeFallbackSecret(name, value) {
    const secrets = readFallbackSecrets();
    if (value == null) delete secrets[name];
    else secrets[name] = value;
    if (Object.keys(secrets).length) storage.setItem(FALLBACK_SECRETS_KEY, JSON.stringify(secrets));
    else storage.removeItem(FALLBACK_SECRETS_KEY);
  }

  async function getSecret(name) {
    try {
      const value = await invoke('secret_get', { name });
      if (value != null) return value;
    } catch {
      // 자격 증명 저장소를 쓸 수 없으면 아래 대체 저장소를 본다.
    }
    return readFallbackSecrets()[name] ?? null;
  }

  async function setSecret(name, value) {
    try {
      await invoke('secret_set', { name, value });
      writeFallbackSecret(name, null);
    } catch {
      writeFallbackSecret(name, value);
    }
  }

  async function deleteSecret(name) {
    try {
      await invoke('secret_delete', { name });
    } catch {
      // 지울 항목이 없거나 저장소를 쓸 수 없으면 대체 저장소만 비운다.
    }
    writeFallbackSecret(name, null);
  }

  function desiredSecrets(snapshot) {
    const secrets = new Map();
    for (const workspace of snapshot.workspaces) {
      if (workspace.rememberToken && workspace.token) secrets.set(PAT_SECRET_PREFIX + workspace.id, workspace.token);
    }
    if (snapshot.voice.apiKey) secrets.set(OPENAI_SECRET, snapshot.voice.apiKey);
    return secrets;
  }

  async function syncSecrets(snapshot) {
    const desired = desiredSecrets(snapshot);
    for (const [name, value] of desired) {
      if (storedSecrets.get(name) === value) continue;
      await setSecret(name, value);
      storedSecrets.set(name, value);
    }
    for (const name of [...storedSecrets.keys()]) {
      if (desired.has(name)) continue;
      await deleteSecret(name);
      storedSecrets.delete(name);
    }
  }

  // 파일에서 읽은 설정에 자격 증명을 채운다. 이미 메모리에 있는 값이 있으면 그것을 쓴다.
  async function attachSecrets(snapshot, current = null) {
    for (const workspace of snapshot.workspaces) {
      const known = current?.workspaces.find((item) => item.id === workspace.id)?.token;
      const name = PAT_SECRET_PREFIX + workspace.id;
      if (known) {
        workspace.token = known;
      } else if (workspace.rememberToken) {
        workspace.token = (await getSecret(name)) || '';
        if (workspace.token) storedSecrets.set(name, workspace.token);
      }
    }
    if (current) {
      snapshot.voice.apiKey = current.voice.apiKey;
    } else {
      snapshot.voice.apiKey = (await getSecret(OPENAI_SECRET)) || '';
      if (snapshot.voice.apiKey) storedSecrets.set(OPENAI_SECRET, snapshot.voice.apiKey);
    }
  }

  function rememberLastGood(snapshot) {
    try {
      storage.setItem(LAST_GOOD_KEY, JSON.stringify({
        ...snapshot,
        workspaces: snapshot.workspaces.map(({ token, ...workspace }) => workspace),
        voice: { ...snapshot.voice, apiKey: '' }
      }));
    } catch {
      // 첫 화면 테마 힌트일 뿐이라 실패해도 설정 저장에는 지장이 없다.
    }
  }

  function readLastGood() {
    try {
      const saved = JSON.parse(storage.getItem(LAST_GOOD_KEY) || 'null');
      if (!saved) return null;
      // 저장 형식이 바뀌어도 안전하도록 config.toml 형식으로 한 번 돌려 정규화한다.
      return parseConfig(renderConfig({ ...defaultSnapshot(), ...saved }), createId).snapshot;
    } catch {
      return null;
    }
  }

  async function report(details) {
    try {
      await invoke('settings_report', { text: renderStatus({ loadedAt: now().toISOString(), ...details }) });
    } catch {
      // 상태 파일은 확인용이라 쓰지 못해도 설정 자체에는 지장이 없다.
    }
  }

  async function writeNow() {
    const snapshot = installedSnapshot();
    if (!snapshot) return;
    await syncSecrets(snapshot);
    const text = renderConfig(snapshot);
    if (text !== lastWrittenText) {
      await invoke('settings_write', { text });
      lastWrittenText = text;
    }
    rememberLastGood(snapshot);
  }

  // 여러 번 바뀌어도 대기 중인 저장은 하나만 두고, 차례가 오면 그때의 최신 값을 쓴다.
  function schedulePersist() {
    if (persistQueued) return queue;
    persistQueued = true;
    return enqueue(async () => {
      persistQueued = false;
      try {
        await writeNow();
      } catch (reason) {
        console.warn('Ginote: could not save settings', reason);
      }
    });
  }

  function legacySnapshot() {
    const document = loadSettingsDocument();
    return {
      ...defaultSnapshot(),
      workspaces: document?.workspaces ?? [],
      activeWorkspaceId: document?.activeWorkspaceId ?? '',
      preferences: document?.preferences ?? defaultSnapshot().preferences,
      voice: loadVoiceSettings(),
      sidebarWidth: loadSidebarWidth()
    };
  }

  async function init() {
    const file = await invoke('settings_read');
    if (file.text == null) {
      // 처음 실행: 웹 시절 localStorage 설정을 옮긴다. 다 옮긴 뒤에만 지운다.
      const snapshot = legacySnapshot();
      useInstalledSnapshot(snapshot, schedulePersist);
      await writeNow();
      for (const key of [STORAGE_KEY, VOICE_SETTINGS_STORAGE_KEY, SIDEBAR_WIDTH_STORAGE_KEY]) storage.removeItem(key);
      await report({});
      return snapshot;
    }

    let parsed;
    try {
      parsed = parseConfig(file.text, createId);
    } catch (reason) {
      if (!(reason instanceof ConfigSyntaxError)) throw reason;
      // 파일이 깨졌으면 마지막 정상 설정으로 띄운다. 파일은 앱에서 설정을 바꿀 때 다시 쓴다.
      const snapshot = readLastGood() ?? defaultSnapshot();
      await attachSecrets(snapshot);
      lastWrittenText = file.text;
      useInstalledSnapshot(snapshot, schedulePersist);
      await report({ syntaxError: reason });
      return snapshot;
    }
    await attachSecrets(parsed.snapshot);
    lastWrittenText = file.text;
    useInstalledSnapshot(parsed.snapshot, schedulePersist);
    if (parsed.rewrite) await writeNow();
    else rememberLastGood(parsed.snapshot);
    await report({ problems: parsed.problems });
    return parsed.snapshot;
  }

  // 바깥에서 config.toml을 고쳤을 때. 앱이 방금 쓴 내용이면 무시한다.
  async function reload() {
    const current = installedSnapshot();
    if (!current) return;
    const file = await invoke('settings_read');
    if (file.text == null) {
      // 지워졌으면 지금 설정으로 다시 만든다.
      lastWrittenText = null;
      await writeNow();
      return;
    }
    if (file.text === lastWrittenText) return;
    lastWrittenText = file.text;
    let parsed;
    try {
      parsed = parseConfig(file.text, createId);
    } catch (reason) {
      if (!(reason instanceof ConfigSyntaxError)) throw reason;
      await report({ syntaxError: reason });
      for (const listener of listeners) listener({ snapshot: null, problems: [], syntaxError: reason });
      return;
    }
    await attachSecrets(parsed.snapshot, current);
    useInstalledSnapshot(parsed.snapshot, schedulePersist);
    // 목록에서 빠진 워크스페이스의 PAT와 remember_token = false가 된 PAT는 여기서 지운다.
    // 파일은 고친 사람이 쓴 그대로 두고, 앱이 id를 새로 붙여야 할 때만 다시 쓴다.
    await syncSecrets(parsed.snapshot);
    if (parsed.rewrite) await writeNow();
    else rememberLastGood(parsed.snapshot);
    await report({ problems: parsed.problems });
    for (const listener of listeners) listener({ snapshot: parsed.snapshot, problems: parsed.problems, syntaxError: null });
  }

  async function watch() {
    return listen('settings-file-changed', () => {
      void enqueue(() => reload().catch((reason) => console.warn('Ginote: could not reload settings', reason)));
    });
  }

  return {
    init: () => enqueue(init),
    watch,
    flush: () => queue,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

let backend = null;

// 화면을 띄우기 전에 부른다. 설치형 앱이면 config.toml과 자격 증명을 읽어 둔다.
// 웹이거나 이 command가 없는 오래된 셸이면 아무것도 하지 않고 localStorage를 그대로 쓴다.
export async function initInstalledSettings({ isTauri = Boolean(globalThis.__TAURI_INTERNALS__), ...options } = {}) {
  if (!isTauri) return false;
  const candidate = createSettingsBackend(options);
  try {
    await candidate.init();
  } catch (reason) {
    console.warn('Ginote: settings file unavailable, using browser storage', reason);
    useInstalledSnapshot(null, null);
    return false;
  }
  backend = candidate;
  void backend.watch().catch(() => {});
  return true;
}

// 바깥에서 config.toml을 고쳐 다시 읽었을 때 알림을 받는다. 웹에서는 아무 일도 없다.
export function onInstalledSettingsChange(listener) {
  return backend ? backend.subscribe(listener) : () => {};
}

// 첫 화면을 칠하기 전에 쓸 테마. 설치형 앱의 마지막 정상 설정에서 읽는다.
export function lastKnownInstalledTheme(storage = globalThis.localStorage) {
  try {
    return JSON.parse(storage.getItem(LAST_GOOD_KEY) || 'null')?.preferences?.theme;
  } catch {
    return undefined;
  }
}
