import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadPinnedNotes,
  MAX_PINNED_NOTES,
  replacePinnedNoteSnapshot,
  savePinnedNotes,
  togglePinnedNote
} from './pinned-notes-storage.js';

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

describe('loadPinnedNotes / savePinnedNotes', () => {
  it('워크스페이스가 없으면 빈 배열을 반환한다', () => {
    expect(loadPinnedNotes('')).toEqual([]);
  });

  it('저장한 적 없는 워크스페이스는 빈 배열을 반환한다', () => {
    expect(loadPinnedNotes('workspace-1')).toEqual([]);
  });

  it('워크스페이스별로 분리해 저장하고 불러온다', () => {
    savePinnedNotes('workspace-1', [{ id: 1 }]);
    savePinnedNotes('workspace-2', [{ id: 2 }]);
    expect(loadPinnedNotes('workspace-1')).toEqual([{ id: 1 }]);
    expect(loadPinnedNotes('workspace-2')).toEqual([{ id: 2 }]);
  });

  it('최대 개수를 넘겨 저장해도 불러올 때 컷한다', () => {
    const many = Array.from({ length: MAX_PINNED_NOTES + 5 }, (_, index) => ({ id: index }));
    savePinnedNotes('workspace-1', many);
    expect(loadPinnedNotes('workspace-1')).toHaveLength(MAX_PINNED_NOTES);
  });
});

describe('togglePinnedNote', () => {
  it('없으면 맨 앞에 추가한다', () => {
    const result = togglePinnedNote([{ id: 1 }], { id: 2 });
    expect(result).toEqual([{ id: 2 }, { id: 1 }]);
  });

  it('이미 있으면 제거한다', () => {
    const result = togglePinnedNote([{ id: 1 }, { id: 2 }], { id: 1 });
    expect(result).toEqual([{ id: 2 }]);
  });

  it('최대치에 도달하면 새 항목을 무시하고 원본을 그대로 반환한다', () => {
    const full = Array.from({ length: MAX_PINNED_NOTES }, (_, index) => ({ id: index }));
    const result = togglePinnedNote(full, { id: 'new' });
    expect(result).toBe(full);
  });
});

describe('replacePinnedNoteSnapshot', () => {
  it('id가 일치하는 항목만 최신 데이터로 교체한다', () => {
    const result = replacePinnedNoteSnapshot(
      [{ id: 1, title: 'old' }, { id: 2, title: 'other' }],
      { id: 1, title: 'new' }
    );
    expect(result).toEqual([{ id: 1, title: 'new' }, { id: 2, title: 'other' }]);
  });

  it('일치하는 항목이 없으면 원본을 그대로 반환한다', () => {
    const original = [{ id: 1, title: 'old' }];
    const result = replacePinnedNoteSnapshot(original, { id: 99, title: 'new' });
    expect(result).toBe(original);
  });
});
