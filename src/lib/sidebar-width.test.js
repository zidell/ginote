import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampSidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN
} from './sidebar-width.js';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('sidebar-width', () => {
  it('허용 범위로 자르고 숫자가 아니면 기본값을 쓴다', () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(5000)).toBe(SIDEBAR_WIDTH_MAX);
    expect(clampSidebarWidth('420')).toBe(420);
    expect(clampSidebarWidth('넓게')).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it('저장한 폭을 다시 읽고, 저장값이 없으면 기본값이다', () => {
    expect(loadSidebarWidth()).toBe(SIDEBAR_WIDTH_DEFAULT);
    saveSidebarWidth(480);
    expect(loadSidebarWidth()).toBe(480);
  });

  it('저장소를 쓸 수 없어도 오류 없이 기본값으로 동작한다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => saveSidebarWidth(480)).not.toThrow();
    expect(loadSidebarWidth()).toBe(SIDEBAR_WIDTH_DEFAULT);
  });
});
