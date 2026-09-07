import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampNumber,
  createWorkspaceRecord,
  loadSettingsDocument,
  normalizeBackgroundRefreshMinutes,
  normalizeLockSessionMinutes,
  normalizePreferences,
  preferenceSignature,
  removeSettingsDocument,
  renameWorkspace,
  reorderWorkspace,
  saveSettingsDocument,
  STORAGE_KEY,
  workspaceDisplayName
} from './settings-storage.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clampNumber', () => {
  it('범위를 벗어나면 경계값으로 자른다', () => {
    expect(clampNumber(5, 10, 30, 20)).toBe(10);
    expect(clampNumber(50, 10, 30, 20)).toBe(30);
    expect(clampNumber(15, 10, 30, 20)).toBe(15);
  });

  it('숫자로 변환할 수 없으면 fallback을 반환한다', () => {
    expect(clampNumber('abc', 10, 30, 20)).toBe(20);
    expect(clampNumber(undefined, 10, 30, 20)).toBe(20);
  });
});

describe('normalizeBackgroundRefreshMinutes / normalizeLockSessionMinutes', () => {
  it('허용된 옵션이 아니면 기본값으로 되돌린다', () => {
    expect(normalizeBackgroundRefreshMinutes(15)).toBe(15);
    expect(normalizeBackgroundRefreshMinutes(999)).toBe(60);
    expect(normalizeLockSessionMinutes(1440)).toBe(1440);
    expect(normalizeLockSessionMinutes(999)).toBe(60);
  });
});

describe('normalizePreferences', () => {
  it('값이 없으면 전부 기본값을 채운다', () => {
    expect(normalizePreferences(undefined)).toEqual({
      titleMode: 'first-line',
      listRowFields: { title: true, summary: true, meta: true, tags: true },
      editorFont: 'system',
      editorFontSize: 17,
      editorLineHeight: 1.8,
      editorMaxWidth: 840,
      autoSaveSeconds: 5,
      issuePageSize: 30,
      backgroundRefreshMinutes: 60,
      lockSessionMinutes: 60,
      language: 'auto'
    });
  });

  it('지원하지 않는 언어 코드는 auto로 되돌린다', () => {
    expect(normalizePreferences({ language: 'xx' }).language).toBe('auto');
    expect(normalizePreferences({ language: 'ko' }).language).toBe('ko');
  });
});

describe('preferenceSignature', () => {
  it('같은 값이면 같은 서명을, 다르면 다른 서명을 만든다', () => {
    const a = normalizePreferences({ titleMode: 'separate' });
    const b = normalizePreferences({ titleMode: 'separate' });
    const c = normalizePreferences({ titleMode: 'first-line' });
    expect(preferenceSignature(a)).toBe(preferenceSignature(b));
    expect(preferenceSignature(a)).not.toBe(preferenceSignature(c));
  });
});

describe('loadSettingsDocument / saveSettingsDocument (워크스페이스 스키마)', () => {
  it('저장한 워크스페이스 목록을 그대로 왕복해서 읽어온다', () => {
    const workspace = createWorkspaceRecord({ repo: 'zidell/ginote', token: 'github_pat_abc', rememberToken: true });
    saveSettingsDocument({
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
      preferences: normalizePreferences({ titleMode: 'separate', issuePageSize: 50 })
    });
    const loaded = loadSettingsDocument();
    expect(loaded.workspaces).toHaveLength(1);
    expect(loaded.workspaces[0]).toEqual(workspace);
    expect(loaded.activeWorkspaceId).toBe(workspace.id);
    expect(loaded.preferences.titleMode).toBe('separate');
    expect(loaded.preferences.issuePageSize).toBe(50);
  });

  it('rememberToken이 false인 워크스페이스는 토큰을 저장하지 않는다', () => {
    const workspace = createWorkspaceRecord({ repo: 'zidell/ginote', token: 'github_pat_abc', rememberToken: false });
    saveSettingsDocument({ workspaces: [workspace], activeWorkspaceId: workspace.id, preferences: normalizePreferences() });
    const loaded = loadSettingsDocument();
    expect(loaded.workspaces[0].token).toBe('');
    expect(loaded.workspaces[0].rememberToken).toBe(false);
  });

  it('저장된 값이 없으면 빈 워크스페이스 목록을 반환한다', () => {
    const loaded = loadSettingsDocument();
    expect(loaded.workspaces).toEqual([]);
    expect(loaded.activeWorkspaceId).toBe('');
    expect(loaded.preferences.titleMode).toBe('first-line');
  });

  it('손상된 JSON은 저장소를 비우고 null을 반환한다', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');
    expect(loadSettingsDocument()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('removeSettingsDocument는 저장된 문서를 지운다', () => {
    const workspace = createWorkspaceRecord({ repo: 'a/b', token: 't', rememberToken: true });
    saveSettingsDocument({ workspaces: [workspace], activeWorkspaceId: workspace.id, preferences: normalizePreferences() });
    removeSettingsDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('workspaceDisplayName', () => {
  it('displayName이 없으면 저장소 주소를 기본값으로 돌려준다', () => {
    expect(workspaceDisplayName({ repo: 'zidell/ginote', displayName: '' })).toBe('zidell/ginote');
    expect(workspaceDisplayName({ repo: 'zidell/ginote' })).toBe('zidell/ginote');
  });

  it('displayName이 있으면 그 값을 돌려준다', () => {
    expect(workspaceDisplayName({ repo: 'zidell/ginote', displayName: '개인 노트' })).toBe('개인 노트');
  });

  it('공백만 있는 displayName은 무시하고 저장소 주소로 되돌린다', () => {
    expect(workspaceDisplayName({ repo: 'zidell/ginote', displayName: '   ' })).toBe('zidell/ginote');
  });
});

describe('renameWorkspace', () => {
  const a = { id: 'a', repo: 'x/a', displayName: '' };
  const b = { id: 'b', repo: 'x/b', displayName: '' };

  it('일치하는 id의 displayName만 바꾸고 나머지는 그대로 둔다', () => {
    const next = renameWorkspace([a, b], 'b', '  둘째  ');
    expect(next).toEqual([a, { ...b, displayName: '둘째' }]);
  });

  it('존재하지 않는 id면 아무 것도 바뀌지 않는다', () => {
    expect(renameWorkspace([a, b], 'missing', '이름')).toEqual([a, b]);
  });

  it('원본 배열을 변경하지 않는다', () => {
    const original = [a, b];
    renameWorkspace(original, 'a', '이름');
    expect(original).toEqual([a, b]);
  });
});

describe('reorderWorkspace', () => {
  const a = { id: 'a', repo: 'x/a' };
  const b = { id: 'b', repo: 'x/b' };
  const c = { id: 'c', repo: 'x/c' };

  it('up으로 이동하면 바로 앞 항목과 자리를 바꾼다', () => {
    expect(reorderWorkspace([a, b, c], 'b', 'up')).toEqual([b, a, c]);
  });

  it('down으로 이동하면 바로 뒤 항목과 자리를 바꾼다', () => {
    expect(reorderWorkspace([a, b, c], 'b', 'down')).toEqual([a, c, b]);
  });

  it('맨 앞에서 up, 맨 뒤에서 down을 하면 순서가 바뀌지 않는다', () => {
    expect(reorderWorkspace([a, b, c], 'a', 'up')).toEqual([a, b, c]);
    expect(reorderWorkspace([a, b, c], 'c', 'down')).toEqual([a, b, c]);
  });

  it('존재하지 않는 id면 원본과 동일한 배열을 반환한다', () => {
    expect(reorderWorkspace([a, b, c], 'missing', 'up')).toEqual([a, b, c]);
  });

  it('원본 배열을 변경하지 않는다', () => {
    const original = [a, b, c];
    reorderWorkspace(original, 'b', 'up');
    expect(original).toEqual([a, b, c]);
  });
});

describe('loadSettingsDocument 구버전 마이그레이션', () => {
  it('{repo, token, preferences} 단일 값을 워크스페이스 1개로 감싼다', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        repo: 'zidell/ginote',
        token: 'github_pat_legacy',
        preferences: { titleMode: 'separate', issuePageSize: 45 }
      })
    );
    const loaded = loadSettingsDocument();
    expect(loaded.workspaces).toHaveLength(1);
    expect(loaded.workspaces[0].repo).toBe('zidell/ginote');
    expect(loaded.workspaces[0].token).toBe('github_pat_legacy');
    expect(loaded.workspaces[0].rememberToken).toBe(true);
    expect(loaded.activeWorkspaceId).toBe(loaded.workspaces[0].id);
    expect(loaded.preferences.titleMode).toBe('separate');
    expect(loaded.preferences.issuePageSize).toBe(45);
  });

  it('마이그레이션 후 저장하면 이후에는 워크스페이스 스키마로 읽힌다', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ repo: 'zidell/ginote', token: 'github_pat_legacy', preferences: {} })
    );
    const migrated = loadSettingsDocument();
    saveSettingsDocument(migrated);
    const reloaded = loadSettingsDocument();
    expect(reloaded.workspaces).toEqual(migrated.workspaces);
    expect(reloaded.activeWorkspaceId).toBe(migrated.activeWorkspaceId);
  });

  it('activeWorkspaceId가 목록에 없으면 첫 워크스페이스로 보정한다', () => {
    const workspace = createWorkspaceRecord({ repo: 'a/b', token: 't', rememberToken: true });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'missing-id', preferences: {} })
    );
    const loaded = loadSettingsDocument();
    expect(loaded.activeWorkspaceId).toBe(workspace.id);
  });
});
