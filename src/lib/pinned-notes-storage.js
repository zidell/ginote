export const PINNED_NOTES_STORAGE_KEY = 'issue-note.pinned-notes.v1';
export const MAX_PINNED_NOTES = 30;

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
  return Array.isArray(entries) ? entries.slice(0, MAX_PINNED_NOTES) : [];
}

export function savePinnedNotes(workspaceId, pinnedIssues) {
  if (!workspaceId) return;
  const document = loadDocument();
  document[workspaceId] = pinnedIssues.slice(0, MAX_PINNED_NOTES);
  localStorage.setItem(PINNED_NOTES_STORAGE_KEY, JSON.stringify(document));
}

export function togglePinnedNote(pinnedIssues, issue) {
  if (pinnedIssues.some((item) => item.id === issue.id)) {
    return pinnedIssues.filter((item) => item.id !== issue.id);
  }
  if (pinnedIssues.length >= MAX_PINNED_NOTES) return pinnedIssues;
  return [issue, ...pinnedIssues];
}

export function replacePinnedNoteSnapshot(pinnedIssues, issue) {
  if (!pinnedIssues.some((item) => item.id === issue.id)) return pinnedIssues;
  return pinnedIssues.map((item) => (item.id === issue.id ? issue : item));
}
