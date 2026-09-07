const cache = new Map();

export function getCachedIssueList(workspaceId, maxAgeMinutes = Infinity) {
  const entry = cache.get(workspaceId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > maxAgeMinutes * 60 * 1000) {
    cache.delete(workspaceId);
    return null;
  }
  return entry.snapshot;
}

export function setCachedIssueList(workspaceId, snapshot) {
  cache.set(workspaceId, { snapshot, cachedAt: Date.now() });
}

export function invalidateCachedIssueList(workspaceId) {
  cache.delete(workspaceId);
}

export function clearAllCachedIssueLists() {
  cache.clear();
}
