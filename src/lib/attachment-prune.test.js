import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./github.js', () => ({
  listExpiredClosedIssues: vi.fn(),
  purgeIssueAttachments: vi.fn(async () => null)
}));

import {
  ATTACHMENT_PRUNE_INTERVAL_MS,
  markExpiredAttachmentsPruned,
  purgeExpiredAttachments,
  shouldPruneExpiredAttachments
} from './attachment-prune.js';
import { listExpiredClosedIssues, purgeIssueAttachments } from './github.js';

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('첨부파일 정리 주기', () => {
  it('저장소마다 하루에 한 번만 정리한다', () => {
    const now = 1_000_000_000;
    expect(shouldPruneExpiredAttachments('octo/notes', now)).toBe(true);

    markExpiredAttachmentsPruned('octo/notes', now);
    expect(shouldPruneExpiredAttachments('octo/notes', now + ATTACHMENT_PRUNE_INTERVAL_MS - 1)).toBe(false);
    expect(shouldPruneExpiredAttachments('octo/notes', now + ATTACHMENT_PRUNE_INTERVAL_MS)).toBe(true);
    expect(shouldPruneExpiredAttachments('octo/other', now)).toBe(true);
  });

  it('기록이 깨져 있으면 다시 정리하도록 한다', () => {
    localStorage.setItem('issue-note.attachment-prune.v1', '{broken');
    expect(shouldPruneExpiredAttachments('octo/notes')).toBe(true);
    expect(() => markExpiredAttachmentsPruned('octo/notes')).not.toThrow();
  });
});

describe('purgeExpiredAttachments', () => {
  it('보관 기간이 지난 노트의 첨부를 지우되 열려 있는 노트는 건너뛴다', async () => {
    listExpiredClosedIssues.mockResolvedValue([{ number: 1 }, { number: 2 }, { number: 3 }]);

    const completed = await purgeExpiredAttachments('token', 'octo/notes', { isOpen: (number) => number === 2 });

    expect(completed).toBe(true);
    expect(purgeIssueAttachments.mock.calls.map((call) => call[2])).toEqual([1, 3]);
  });

  it('도중에 실패하면 멈추고 false를 돌려준다', async () => {
    listExpiredClosedIssues.mockResolvedValue([{ number: 1 }, { number: 2 }]);
    purgeIssueAttachments.mockRejectedValueOnce(new Error('rate limit'));

    await expect(purgeExpiredAttachments('token', 'octo/notes')).resolves.toBe(false);
    expect(purgeIssueAttachments).toHaveBeenCalledTimes(1);
  });
});
