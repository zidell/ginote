import { afterEach, describe, expect, it } from 'vitest';
import {
  PENDING_WORK_STORAGE_KEY,
  clearPendingWork,
  loadPendingWork,
  pendingWorkScope,
  updatePendingWork
} from './pending-work.js';

afterEach(() => localStorage.clear());

describe('pending work storage', () => {
  it('저장소와 이슈 번호로 작업 범위를 안정적으로 만든다', () => {
    expect(pendingWorkScope('owner/repo', 5)).toBe('owner/repo#5');
    expect(pendingWorkScope('', 5)).toBe('');
  });

  it('노트별 대기 작업을 합치고 비우면 저장소에서도 제거한다', () => {
    updatePendingWork('owner/repo', 5, {
      noteDraft: { body: '초안' },
      attachmentDeletes: [{ attachment: { path: 'a' }, expiresAt: 1 }]
    });
    updatePendingWork('owner/repo', 5, {
      commentDrafts: [{ id: 'draft-1', body: '댓글' }]
    });

    expect(loadPendingWork('owner/repo', 5)).toEqual(expect.objectContaining({
      noteDraft: { body: '초안' },
      attachmentDeletes: [{ attachment: { path: 'a' }, expiresAt: 1 }],
      commentDrafts: [{ id: 'draft-1', body: '댓글' }]
    }));

    clearPendingWork('owner/repo', 5);
    expect(loadPendingWork('owner/repo', 5)).toBeNull();
    expect(JSON.parse(localStorage.getItem(PENDING_WORK_STORAGE_KEY))).toEqual({});
  });
});
