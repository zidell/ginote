import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('지정한 유지 시간이 지난 캐시는 반환하지 않고 지운다', () => {
    vi.useFakeTimers();
    setCachedIssueList('a', { issues: [] });
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(getCachedIssueList('a', 60)).toBeNull();
    vi.useRealTimers();
  });

  it('새로 저장할 때 유지 시간이 지난 다른 워크스페이스 캐시를 놓는다', () => {
    vi.useFakeTimers();
    setCachedIssueList('a', { issues: [] }, 60);
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    setCachedIssueList('b', { issues: [] }, 60);
    expect(getCachedIssueList('a')).toBeNull();
    expect(getCachedIssueList('b')).not.toBeNull();
    vi.useRealTimers();
  });
});
