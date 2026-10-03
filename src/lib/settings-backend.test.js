import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderConfig, defaultSnapshot } from './app-config.js';
import { useInstalledSnapshot } from './installed-settings.js';
import { LAST_GOOD_KEY, createSettingsBackend } from './settings-backend.js';
import { STORAGE_KEY, loadSettingsDocument, saveSettingsDocument } from './settings-storage.js';
import { VOICE_SETTINGS_STORAGE_KEY, loadVoiceSettings } from './voice-settings.js';

// 네이티브 셸(src-tauri/src/settings.rs)을 흉내 낸다: 파일 하나, 상태 파일, 자격 증명 저장소.
function fakeShell({ text = null, keychainBroken = false } = {}) {
  const shell = {
    text,
    status: '',
    secrets: new Map(),
    writes: 0,
    handler: null,
    async invoke(command, args) {
      switch (command) {
        case 'settings_read': return { path: '/config/config.toml', text: shell.text };
        case 'settings_write': shell.writes += 1; shell.text = args.text; return null;
        case 'settings_report': shell.status = args.text; return null;
        case 'secret_get':
          if (keychainBroken) throw new Error('no keychain');
          return shell.secrets.get(args.name) ?? null;
        case 'secret_set':
          if (keychainBroken) throw new Error('no keychain');
          shell.secrets.set(args.name, args.value);
          return null;
        case 'secret_delete':
          if (keychainBroken) throw new Error('no keychain');
          shell.secrets.delete(args.name);
          return null;
        default: throw new Error(`unknown command ${command}`);
      }
    },
    async listen(event, handler) {
      expect(event).toBe('settings-file-changed');
      shell.handler = handler;
      return () => {};
    }
  };
  return shell;
}

function backendFor(shell) {
  let id = 0;
  return createSettingsBackend({
    invoke: shell.invoke,
    listen: shell.listen,
    storage: localStorage,
    now: () => new Date('2026-10-03T00:00:00Z'),
    createId: () => `generated-${++id}`
  });
}

function configWith(mutate) {
  const snapshot = defaultSnapshot();
  snapshot.workspaces = [
    { id: 'ws-1', repo: 'octo/notes', displayName: '', rememberToken: true, token: '' },
    { id: 'ws-2', repo: 'octo/work', displayName: '', rememberToken: true, token: '' }
  ];
  snapshot.activeWorkspaceId = 'ws-1';
  mutate?.(snapshot);
  return renderConfig(snapshot);
}

async function externalEdit(shell, backend, text) {
  shell.text = text;
  shell.handler();
  await backend.flush();
}

beforeEach(() => {
  localStorage.clear();
  useInstalledSnapshot(null, null);
});

afterEach(() => {
  useInstalledSnapshot(null, null);
});

describe('installed settings backend', () => {
  it('moves browser-storage settings and credentials out of localStorage on first launch', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      workspaces: [{ id: 'ws-1', repo: 'octo/notes', token: 'github_pat_one', rememberToken: true, displayName: 'Mine' }],
      activeWorkspaceId: 'ws-1',
      preferences: { theme: 'light', editorFontSize: 20 }
    }));
    localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify({ apiKey: 'sk-one' }));
    const shell = fakeShell();

    await backendFor(shell).init();

    expect(shell.text).toContain('repo = "octo/notes"');
    expect(shell.text).toContain('theme = "light"');
    expect(shell.text).not.toContain('github_pat_one');
    expect(shell.text).not.toContain('sk-one');
    expect(shell.secrets).toEqual(new Map([['github-pat:ws-1', 'github_pat_one'], ['openai-api-key', 'sk-one']]));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY)).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('github_pat_one');
    expect(loadSettingsDocument().workspaces[0].token).toBe('github_pat_one');
    expect(loadVoiceSettings().apiKey).toBe('sk-one');
    expect(shell.status).toContain('every value was accepted');
  });

  it('reads credentials for remembered workspaces from the credential store', async () => {
    const shell = fakeShell({ text: configWith((snapshot) => { snapshot.workspaces[1].rememberToken = false; }) });
    shell.secrets.set('github-pat:ws-1', 'github_pat_one');
    shell.secrets.set('github-pat:ws-2', 'github_pat_two');

    await backendFor(shell).init();

    expect(loadSettingsDocument().workspaces.map((workspace) => workspace.token)).toEqual(['github_pat_one', '']);
    expect(shell.writes).toBe(0);
  });

  it('saves changes made in the app to the file and the credential store', async () => {
    const shell = fakeShell({ text: configWith() });
    shell.secrets.set('github-pat:ws-1', 'github_pat_one');
    const backend = backendFor(shell);
    await backend.init();

    const document = loadSettingsDocument();
    document.workspaces[0].rememberToken = false;
    document.workspaces[1].token = 'github_pat_two';
    saveSettingsDocument({ ...document, preferences: { ...document.preferences, theme: 'light' } });
    await backend.flush();

    expect(shell.text).toContain('theme = "light"');
    expect(shell.secrets).toEqual(new Map([['github-pat:ws-2', 'github_pat_two']]));
  });

  it('applies an external edit, ignores its own writes and forgets removed workspaces\' tokens', async () => {
    const shell = fakeShell({ text: configWith() });
    shell.secrets.set('github-pat:ws-1', 'github_pat_one');
    shell.secrets.set('github-pat:ws-2', 'github_pat_two');
    const backend = backendFor(shell);
    await backend.init();
    await backend.watch();
    const changes = vi.fn();
    backend.subscribe(changes);

    shell.handler();
    await backend.flush();
    expect(changes).not.toHaveBeenCalled();

    await externalEdit(shell, backend, configWith((snapshot) => {
      snapshot.workspaces = [snapshot.workspaces[1]];
      snapshot.activeWorkspaceId = 'ws-2';
      snapshot.preferences.issuePageSize = 50;
    }));

    expect(changes).toHaveBeenCalledTimes(1);
    const [{ snapshot, problems }] = changes.mock.calls[0];
    expect(problems).toEqual([]);
    expect(snapshot.activeWorkspaceId).toBe('ws-2');
    expect(snapshot.workspaces[0].token).toBe('github_pat_two');
    expect(loadSettingsDocument().preferences.issuePageSize).toBe(50);
    expect(shell.secrets).toEqual(new Map([['github-pat:ws-2', 'github_pat_two']]));
    expect(shell.writes).toBe(0);
  });

  it('keeps the current settings when an edit is not valid TOML', async () => {
    const shell = fakeShell({ text: configWith((snapshot) => { snapshot.preferences.theme = 'light'; }) });
    const backend = backendFor(shell);
    await backend.init();
    await backend.watch();
    const changes = vi.fn();
    backend.subscribe(changes);

    await externalEdit(shell, backend, '[display]\ntheme = \n');

    expect(changes).toHaveBeenCalledWith(expect.objectContaining({ snapshot: null, syntaxError: expect.any(Error) }));
    expect(loadSettingsDocument().preferences.theme).toBe('light');
    expect(shell.status).toContain('not valid TOML');
  });

  it('starts from the last good settings when the file is broken at launch', async () => {
    const good = fakeShell({ text: configWith((snapshot) => { snapshot.preferences.theme = 'light'; }) });
    good.secrets.set('github-pat:ws-1', 'github_pat_one');
    await backendFor(good).init();
    expect(localStorage.getItem(LAST_GOOD_KEY)).not.toContain('github_pat_one');
    useInstalledSnapshot(null, null);

    const broken = fakeShell({ text: 'theme = = "x"' });
    broken.secrets = good.secrets;
    await backendFor(broken).init();

    const document = loadSettingsDocument();
    expect(document.preferences.theme).toBe('light');
    expect(document.workspaces[0].token).toBe('github_pat_one');
    expect(broken.writes).toBe(0);
  });

  it('keeps credentials in browser storage only when the credential store is unavailable', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      workspaces: [{ id: 'ws-1', repo: 'octo/notes', token: 'github_pat_one', rememberToken: true }],
      activeWorkspaceId: 'ws-1'
    }));
    const shell = fakeShell({ keychainBroken: true });
    await backendFor(shell).init();
    expect(shell.text).not.toContain('github_pat_one');
    useInstalledSnapshot(null, null);

    await backendFor(shell).init();
    expect(loadSettingsDocument().workspaces[0].token).toBe('github_pat_one');
  });
});
