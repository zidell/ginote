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

// 만료된 다른 워크스페이스 목록도 이때 놓는다. 다시 열지 않는 워크스페이스의 목록이 남지 않게 한다.
export function setCachedIssueList(workspaceId, snapshot, maxAgeMinutes = Infinity) {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (now - entry.cachedAt > maxAgeMinutes * 60 * 1000) cache.delete(id);
  }
  cache.set(workspaceId, { snapshot, cachedAt: now });
}

export function invalidateCachedIssueList(workspaceId) {
  cache.delete(workspaceId);
}

export function clearAllCachedIssueLists() {
  cache.clear();
}
