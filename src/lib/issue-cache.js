const cache = new Map();

export function getCachedIssueList(workspaceId) {
  return cache.get(workspaceId) || null;
}

export function setCachedIssueList(workspaceId, snapshot) {
  cache.set(workspaceId, snapshot);
}

export function invalidateCachedIssueList(workspaceId) {
  cache.delete(workspaceId);
}

export function clearAllCachedIssueLists() {
  cache.clear();
}
