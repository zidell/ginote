import { clampNumber } from './settings-storage.js';

const SIDEBAR_WIDTH_STORAGE_KEY = 'issue-note.sidebar-width.v1';
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 600;
export const SIDEBAR_WIDTH_DEFAULT = 340;

export function clampSidebarWidth(value) {
  return clampNumber(value, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_DEFAULT);
}

export function loadSidebarWidth() {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw === null) return SIDEBAR_WIDTH_DEFAULT;
    return clampSidebarWidth(raw);
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

export function saveSidebarWidth(width) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // 폭 저장에 실패해도 현재 세션 사용에는 지장이 없다.
  }
}
