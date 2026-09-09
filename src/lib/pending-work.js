export const PENDING_WORK_STORAGE_KEY = 'issue-note.pending-work.v1';

function readStore() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_WORK_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(PENDING_WORK_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 저장소가 막혀 있어도 원격 저장 자체는 계속 시도할 수 있어야 한다.
  }
}

export function pendingWorkScope(repo, issueNumber) {
  if (!repo || !issueNumber) return '';
  return `${repo}#${issueNumber}`;
}

export function loadPendingWork(repo, issueNumber) {
  const scope = pendingWorkScope(repo, issueNumber);
  return scope ? readStore()[scope] || null : null;
}

export function updatePendingWork(repo, issueNumber, patch) {
  const scope = pendingWorkScope(repo, issueNumber);
  if (!scope) return;

  const store = readStore();
  const current = store[scope] || { repo, issueNumber };
  const next = { ...current, ...patch, updatedAt: Date.now() };
  const hasDraft = next.noteDraft && typeof next.noteDraft === 'object';
  const hasAttachments = Array.isArray(next.attachmentDeletes) && next.attachmentDeletes.length > 0;
  const hasComments = Array.isArray(next.commentDrafts) && next.commentDrafts.length > 0;

  if (hasDraft || hasAttachments || hasComments) store[scope] = next;
  else delete store[scope];
  writeStore(store);
}

export function clearPendingWork(repo, issueNumber) {
  const scope = pendingWorkScope(repo, issueNumber);
  if (!scope) return;
  const store = readStore();
  if (!store[scope]) return;
  delete store[scope];
  writeStore(store);
}
