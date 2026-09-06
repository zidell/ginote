import { LOCALE_OPTIONS } from './i18n.js';

export const STORAGE_KEY = 'issue-note.settings.v1';
export const BACKGROUND_REFRESH_DEFAULT_MINUTES = 60;
export const BACKGROUND_REFRESH_OPTIONS = [0, 5, 15, 30, 60, 180];
export const LOCK_SESSION_DEFAULT_MINUTES = 60;
export const LOCK_SESSION_OPTIONS = [5, 15, 30, 60, 180, 480, 720, 1440];

export function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export function normalizeBackgroundRefreshMinutes(value) {
  const minutes = Number(value);
  return BACKGROUND_REFRESH_OPTIONS.includes(minutes) ? minutes : BACKGROUND_REFRESH_DEFAULT_MINUTES;
}

export function normalizeLockSessionMinutes(value) {
  const minutes = Number(value);
  return LOCK_SESSION_OPTIONS.includes(minutes) ? minutes : LOCK_SESSION_DEFAULT_MINUTES;
}

export function normalizePreferences(raw) {
  const savedLanguage = raw?.language || 'auto';
  return {
    titleMode: raw?.titleMode || 'first-line',
    editorFont: raw?.editorFont || 'system',
    editorFontSize: Number(raw?.editorFontSize) || 16,
    editorLineHeight: Number(raw?.editorLineHeight) || 1.7,
    autoSaveSeconds: clampNumber(raw?.autoSaveSeconds, 3, 30, 5),
    issuePageSize: clampNumber(raw?.issuePageSize, 10, 100, 30),
    backgroundRefreshMinutes: normalizeBackgroundRefreshMinutes(raw?.backgroundRefreshMinutes),
    lockSessionMinutes: normalizeLockSessionMinutes(raw?.lockSessionMinutes),
    language: LOCALE_OPTIONS.some((option) => option.value === savedLanguage) ? savedLanguage : 'auto'
  };
}

export function preferenceSignature(preferences) {
  return JSON.stringify([
    preferences.titleMode,
    preferences.editorFont,
    preferences.editorFontSize,
    preferences.editorLineHeight,
    preferences.autoSaveSeconds,
    preferences.issuePageSize,
    preferences.backgroundRefreshMinutes,
    preferences.lockSessionMinutes,
    preferences.language
  ]);
}

export function createWorkspaceRecord({ repo, token, rememberToken, displayName }) {
  return {
    id: crypto.randomUUID(),
    repo,
    token: token || '',
    rememberToken: Boolean(rememberToken),
    displayName: String(displayName || '').trim()
  };
}

// 표시명을 비워두면(기본값) 워크스페이스 이름은 저장소 주소(아이디+저장소명)를 그대로 보여준다.
export function workspaceDisplayName(workspace) {
  return String(workspace?.displayName || '').trim() || workspace?.repo || '';
}

export function renameWorkspace(workspaces, workspaceId, displayName) {
  const trimmed = String(displayName || '').trim();
  return workspaces.map((workspace) =>
    workspace.id === workspaceId ? { ...workspace, displayName: trimmed } : workspace
  );
}

export function reorderWorkspace(workspaces, workspaceId, direction) {
  const index = workspaces.findIndex((workspace) => workspace.id === workspaceId);
  if (index === -1) return workspaces;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= workspaces.length) return workspaces;
  const next = workspaces.slice();
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

function migrateLegacyDocument(saved) {
  // 구버전({repo, token, preferences} 단일 값)은 워크스페이스 1개로 감싼다.
  // 예전에는 항상 "저장"을 기본값으로 취급했으므로 rememberToken도 true로 둔다.
  const workspace = createWorkspaceRecord({ repo: saved.repo || '', token: saved.token || '', rememberToken: true });
  return {
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    preferences: normalizePreferences(saved.preferences)
  };
}

export function loadSettingsDocument() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (Array.isArray(saved.workspaces)) {
      const workspaces = saved.workspaces.map((workspace) => ({
        id: workspace.id,
        repo: workspace.repo || '',
        token: workspace.token || '',
        rememberToken: workspace.rememberToken !== false,
        displayName: String(workspace.displayName || '').trim()
      }));
      const activeWorkspaceId = workspaces.some((workspace) => workspace.id === saved.activeWorkspaceId)
        ? saved.activeWorkspaceId
        : (workspaces[0]?.id || '');
      return { workspaces, activeWorkspaceId, preferences: normalizePreferences(saved.preferences) };
    }
    if (saved.repo || saved.token) {
      return migrateLegacyDocument(saved);
    }
    return { workspaces: [], activeWorkspaceId: '', preferences: normalizePreferences(saved.preferences) };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveSettingsDocument({ workspaces, activeWorkspaceId, preferences }) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        repo: workspace.repo,
        token: workspace.rememberToken ? workspace.token : '',
        rememberToken: workspace.rememberToken,
        displayName: String(workspace.displayName || '').trim()
      })),
      activeWorkspaceId,
      preferences
    })
  );
}

export function removeSettingsDocument() {
  localStorage.removeItem(STORAGE_KEY);
}
