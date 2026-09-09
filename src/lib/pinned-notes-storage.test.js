import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPinnedNotes,
  loadPinnedNotes,
  savePinnedNotes,
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

  it('기존 저장소의 pin을 개수 제한 없이 불러온다', () => {
    const many = Array.from({ length: 105 }, (_, index) => ({ id: index }));
    savePinnedNotes('workspace-1', many);
    expect(loadPinnedNotes('workspace-1')).toHaveLength(105);
  });

  it('워크스페이스의 이전 pin 저장소를 지운다', () => {
    savePinnedNotes('workspace-1', [{ id: 1 }]);
    savePinnedNotes('workspace-2', [{ id: 2 }]);

    clearPinnedNotes('workspace-1');

    expect(loadPinnedNotes('workspace-1')).toEqual([]);
    expect(loadPinnedNotes('workspace-2')).toEqual([{ id: 2 }]);
  });
});
