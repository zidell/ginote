export const PINNED_NOTES_STORAGE_KEY = 'issue-note.pinned-notes.v1';

function loadDocument() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_NOTES_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadPinnedNotes(workspaceId) {
  if (!workspaceId) return [];
  const document = loadDocument();
  const entries = document[workspaceId];
  return Array.isArray(entries) ? entries : [];
}

export function savePinnedNotes(workspaceId, pinnedIssues) {
  if (!workspaceId) return;
  const document = loadDocument();
  document[workspaceId] = pinnedIssues;
  localStorage.setItem(PINNED_NOTES_STORAGE_KEY, JSON.stringify(document));
}

export function clearPinnedNotes(workspaceId) {
  if (!workspaceId) return;
  const document = loadDocument();
  if (!(workspaceId in document)) return;
  delete document[workspaceId];
  if (Object.keys(document).length) localStorage.setItem(PINNED_NOTES_STORAGE_KEY, JSON.stringify(document));
  else localStorage.removeItem(PINNED_NOTES_STORAGE_KEY);
}
