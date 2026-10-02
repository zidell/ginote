import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./github.js', () => ({
  createIssue: vi.fn(),
  downloadAttachment: vi.fn(),
  getIssue: vi.fn(),
  listAllIssueAttachmentFiles: vi.fn(),
  listIssueComments: vi.fn(),
  setIssueState: vi.fn(async () => null),
  updateIssue: vi.fn(),
  uploadAttachment: vi.fn()
}));

import {
  createIssue,
  downloadAttachment,
  getIssue,
  listAllIssueAttachmentFiles,
  listIssueComments,
  setIssueState,
  updateIssue,
  uploadAttachment
} from './github.js';
import { attachmentRawUrl } from './attachments.js';
import { MAX_ISSUE_BODY_LENGTH } from './github-limits.js';
import { setAppLocale } from './i18n.js';
import { MergeError, mergeIssues } from './merge-notes.js';

const sources = {
  1: { id: 10, number: 1, title: '먼저 쓴 노트', body: '첫 본문', labels: [{ name: 'work' }, { name: 'ginote:pin' }], created_at: '2026-09-01T00:00:00Z' },
  2: { id: 20, number: 2, title: '나중 노트', body: `![사진](${attachmentRawUrl('octo/notes', '.issue-note-assets/issues/2/photo.png')})`, labels: [{ name: 'Work' }, { name: 'home' }], created_at: '2026-09-02T00:00:00Z' }
};

beforeAll(() => setAppLocale('en'));

beforeEach(() => {
  getIssue.mockImplementation(async (token, repo, number) => structuredClone(sources[number]));
  listIssueComments.mockImplementation(async (token, repo, number) => number === 1
    ? [{ id: 5, body: '첫 댓글', createdAt: '2026-09-03T00:00:00Z' }]
    : []);
  listAllIssueAttachmentFiles.mockImplementation(async (token, repo, number) => number === 2
    ? [{ name: 'photo.png', path: '.issue-note-assets/issues/2/photo.png', type: 'image/png' }]
    : []);
  downloadAttachment.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  uploadAttachment.mockImplementation(async (token, repo, number, file) => ({ path: `.issue-note-assets/issues/${number}/copied-${file.name}` }));
  createIssue.mockResolvedValue({ id: 900, number: 90 });
  updateIssue.mockImplementation(async (token, repo, number, note) => ({ id: 900, number, ...note }));
});

afterEach(() => vi.clearAllMocks());

describe('mergeIssues', () => {
  it('가장 먼저 쓴 노트 제목으로 새 노트를 만들고, 첨부를 복사한 뒤 원본을 닫는다', async () => {
    const result = await mergeIssues('token', 'octo/notes', [{ number: 2 }, { number: 1 }]);

    const [, , draft] = createIssue.mock.calls[0];
    // 대소문자만 다른 태그는 뒤에 나온 표기를 쓴다.
    expect(draft).toMatchObject({ title: '먼저 쓴 노트', labels: ['work', 'home'] });
    expect(uploadAttachment).toHaveBeenCalledWith('token', 'octo/notes', 90, expect.any(File));

    const [, , number, saved] = updateIssue.mock.calls[0];
    expect(number).toBe(90);
    expect(saved.body).toContain('첫 본문');
    expect(saved.body).toContain('첫 댓글');
    expect(saved.body).toContain('issues/90/copied-photo.png');
    expect(saved.body).not.toContain('issues/2/photo.png');

    expect(setIssueState.mock.calls.map((call) => call.slice(2))).toEqual([[2, 'closed'], [1, 'closed']]);
    expect(result.mergedIssue.number).toBe(90);
    expect([...result.closedSourceIds]).toEqual([20, 10]);
    expect(result.closeFailures).toEqual([]);
  });

  it('원본 하나를 닫지 못해도 병합은 끝내고 실패한 번호를 알린다', async () => {
    setIssueState.mockImplementation(async (token, repo, number) => {
      if (number === 1) throw new Error('403');
      return null;
    });

    const result = await mergeIssues('token', 'octo/notes', [{ number: 1 }, { number: 2 }]);

    expect(result.closeFailures).toEqual([1]);
    expect([...result.closedSourceIds]).toEqual([20]);
  });

  it('원본을 읽다가 실패하면 아무것도 만들지 않는다', async () => {
    getIssue.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }));

    const failure = await mergeIssues('token', 'octo/notes', [{ number: 1 }, { number: 2 }]).catch((reason) => reason);

    expect(failure).toBeInstanceOf(MergeError);
    expect(failure.draftNumber).toBeNull();
    expect(failure.cause.status).toBe(404);
    expect(createIssue).not.toHaveBeenCalled();
    expect(setIssueState).not.toHaveBeenCalled();
  });

  it('합친 본문이 GitHub 한도를 넘으면 새 노트를 만들기 전에 멈춘다', async () => {
    getIssue.mockImplementation(async (token, repo, number) => ({ ...structuredClone(sources[number]), body: 'x'.repeat(MAX_ISSUE_BODY_LENGTH) }));

    const failure = await mergeIssues('token', 'octo/notes', [{ number: 1 }, { number: 2 }]).catch((reason) => reason);

    expect(failure.message).toContain(String(MAX_ISSUE_BODY_LENGTH));
    expect(failure.draftNumber).toBeNull();
    expect(createIssue).not.toHaveBeenCalled();
  });

  it('새 노트를 만든 뒤 실패하면 임시 노트를 휴지통으로 보내고 원본은 그대로 둔다', async () => {
    uploadAttachment.mockRejectedValueOnce(new Error('upload failed'));

    const failure = await mergeIssues('token', 'octo/notes', [{ number: 1 }, { number: 2 }]).catch((reason) => reason);

    expect(failure).toBeInstanceOf(MergeError);
    expect(failure.draftNumber).toBe(90);
    expect(failure.message).toBe('upload failed');
    expect(setIssueState.mock.calls.map((call) => call.slice(2))).toEqual([[90, 'closed']]);
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it('임시 노트를 닫지 못해도 원래 실패 원인을 알린다', async () => {
    updateIssue.mockRejectedValueOnce(new Error('save failed'));
    setIssueState.mockRejectedValueOnce(new Error('close failed'));

    const failure = await mergeIssues('token', 'octo/notes', [{ number: 1 }, { number: 2 }]).catch((reason) => reason);

    expect(failure.message).toBe('save failed');
    expect(failure.draftNumber).toBe(90);
  });
});
