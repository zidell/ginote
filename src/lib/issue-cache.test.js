import { afterEach, describe, expect, it } from 'vitest';
import { clearAllCachedIssueLists, getCachedIssueList, invalidateCachedIssueList, setCachedIssueList } from './issue-cache.js';

afterEach(() => {
  clearAllCachedIssueLists();
});

describe('issue-cache', () => {
  it('워크스페이스별로 스냅샷을 저장하고 조회한다', () => {
    expect(getCachedIssueList('a')).toBeNull();
    setCachedIssueList('a', { issues: [{ id: 1 }] });
    expect(getCachedIssueList('a')).toEqual({ issues: [{ id: 1 }] });
    expect(getCachedIssueList('b')).toBeNull();
  });

  it('invalidateCachedIssueList는 해당 워크스페이스만 지운다', () => {
    setCachedIssueList('a', { issues: [] });
    setCachedIssueList('b', { issues: [] });
    invalidateCachedIssueList('a');
    expect(getCachedIssueList('a')).toBeNull();
    expect(getCachedIssueList('b')).not.toBeNull();
  });

  it('clearAllCachedIssueLists는 전체를 지운다', () => {
    setCachedIssueList('a', { issues: [] });
    setCachedIssueList('b', { issues: [] });
    clearAllCachedIssueLists();
    expect(getCachedIssueList('a')).toBeNull();
    expect(getCachedIssueList('b')).toBeNull();
  });
});
