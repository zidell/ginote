import { describe, expect, it } from 'vitest';
import { attachmentRawUrl } from './attachments.js';
import { earliestIssue, formatMergedBody, mergeTimeline, replaceAttachmentUrls } from './note-merge.js';

describe('note merge', () => {
  const first = {
    number: 9,
    title: '첫 노트',
    body: '첫 본문',
    created_at: '2026-01-01T09:00:00Z',
    html_url: 'https://github.com/o/r/issues/9',
    user: { login: 'alice' },
    comments: [{ id: 1, body: '나중 댓글', createdAt: '2026-01-02T09:00:00Z', author: 'bob', url: 'https://github.com/o/r/issues/9#issuecomment-1' }]
  };
  const second = {
    number: 4,
    title: '둘째 노트',
    body: '둘째 본문',
    created_at: '2026-01-01T10:00:00Z',
    html_url: 'https://github.com/o/r/issues/4',
    user: { login: 'carol' },
    comments: [{ id: 2, body: '중간 댓글', createdAt: '2026-01-01T11:00:00Z', author: 'dave', url: '' }]
  };

  it('가장 먼저 만든 이슈를 기준으로 정하고 본문과 댓글을 시간순으로 섞는다', () => {
    expect(earliestIssue([second, first])).toBe(first);
    expect(mergeTimeline([second, first]).map((entry) => entry.body)).toEqual([
      '첫 본문', '둘째 본문', '중간 댓글', '나중 댓글'
    ]);
  });

  it('원래 시각과 작성자만 초 단위 헤딩으로 갖는 병합 본문을 만든다', () => {
    const body = formatMergedBody(mergeTimeline([first]));
    expect(body).toMatch(/## 2026-01-01 \d{2}:00:00 @alice/);
    expect(body).not.toContain('병합된 기록');
    expect(body).not.toContain('[원본]');
    expect(body).not.toContain('#9 본문');
  });

  it('복사한 첨부파일의 raw URL만 새 이슈 파일로 바꾼다', () => {
    const from = '.issue-note-assets/issues/9/old.png';
    const to = '.issue-note-assets/issues/20/new.png';
    const body = `![](${attachmentRawUrl('o/r', from)})`;
    expect(replaceAttachmentUrls(body, 'o/r', new Map([[from, to]]))).toBe(
      `![](${attachmentRawUrl('o/r', to)})`
    );
  });
});
