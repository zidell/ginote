import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import NoteEditor from './NoteEditor.svelte';
import { composeAttachmentLink } from './attachments.js';
import { setAppLocale } from './i18n.js';

vi.mock('./github.js', () => ({
  createIssue: vi.fn(),
  createIssueComment: vi.fn(async (token, repo, issueNumber, body) => ({
    id: 99,
    body,
    author: 'octocat',
    avatarUrl: '',
    createdAt: '2026-09-05T00:00:00Z',
    updatedAt: '2026-09-05T00:00:00Z',
    url: ''
  })),
  createLabel: vi.fn(),
  deleteAttachment: vi.fn(async () => null),
  deleteIssueComment: vi.fn(async () => null),
  downloadAttachment: vi.fn(),
  getIssue: vi.fn(),
  listIssueAttachmentFiles: vi.fn(async () => []),
  listIssueComments: vi.fn(async () => [{
    id: 1,
    body: '댓글 내용',
    author: 'octocat',
    avatarUrl: '',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    url: ''
  }]),
  updateIssue: vi.fn(async (token, repo, issueNumber, note) => ({
    number: issueNumber,
    title: note.title,
    body: note.body,
    labels: (note.labels || []).map((name) => ({ name })),
    comments: 0,
    updated_at: '2026-09-06T00:00:00Z'
  })),
  updateIssueComment: vi.fn(async (token, repo, commentId, body) => ({
    id: commentId,
    body,
    author: 'octocat',
    avatarUrl: '',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    url: ''
  })),
  uploadAttachment: vi.fn(async (token, repo, issueNumber, file) => ({
    name: file.name,
    type: file.type,
    path: `.issue-note-assets/issues/${issueNumber}/uuid-${file.name}`,
    sha: 'file-sha',
    size: file.size,
    url: 'https://github.com/file'
  }))
}));

const {
  createIssueComment,
  deleteAttachment,
  deleteIssueComment,
  listIssueAttachmentFiles,
  updateIssue,
  updateIssueComment
} = await import('./github.js');

const baseIssue = {
  number: 5,
  title: '노트 제목',
  body: '노트 본문',
  labels: [],
  comments: 1,
  updated_at: '2026-09-01T00:00:00Z'
};

beforeAll(() => {
  setAppLocale('en');
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NoteEditor 코멘트 블록', () => {
  it('본문 아래 독립된 블록으로 가져온 댓글을 보여준다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
    const commentBody = document.querySelector('.note-comment-body');
    expect(commentBody.value).toBe('댓글 내용');
    expect(document.querySelector('.note-comments-section')).toBeTruthy();
  });

  it('댓글을 textarea로 수정하고 포커스를 벗어나면 저장한다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
    const commentBody = document.querySelector('.note-comment-body');

    await fireEvent.input(commentBody, { target: { value: '수정한 댓글' } });
    await fireEvent.blur(commentBody);

    await waitFor(() => expect(updateIssueComment).toHaveBeenCalledWith('t', 'owner/repo', 1, '수정한 댓글'));
  });

  it('내용을 바꾸지 않고 포커스를 벗어나면 저장하지 않는다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
    const commentBody = document.querySelector('.note-comment-body');

    await fireEvent.blur(commentBody);

    expect(updateIssueComment).not.toHaveBeenCalled();
  });

  it('댓글 추가 버튼으로 새 댓글을 만들고 입력 후 저장한다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
    await fireEvent.click(screen.getByText('Add comment'));

    const bodies = document.querySelectorAll('.note-comment-body');
    const draft = bodies[bodies.length - 1];

    await fireEvent.input(draft, { target: { value: '새 댓글' } });
    await fireEvent.blur(draft);

    await waitFor(() => expect(createIssueComment).toHaveBeenCalledWith('t', 'owner/repo', 5, '새 댓글'));
  });

  it('빈 채로 남겨진 새 댓글은 저장하지 않고 제거한다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
    await fireEvent.click(screen.getByText('Add comment'));

    const bodiesBefore = document.querySelectorAll('.note-comment-body');
    const draft = bodiesBefore[bodiesBefore.length - 1];
    await fireEvent.blur(draft);

    expect(createIssueComment).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.note-comment-body').length).toBe(bodiesBefore.length - 1);
  });

  it('더보기 메뉴에서 삭제를 누르면 확인 후 댓글을 삭제한다', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
    await fireEvent.click(document.querySelector('.note-comment-item .dropdown-item'));

    await waitFor(() => expect(deleteIssueComment).toHaveBeenCalledWith('t', 'owner/repo', 1));
    vi.unstubAllGlobals();
  });
});

describe('NoteEditor 첨부 파일', () => {
  it('파일을 업로드하면 본문에 링크를 끼워 넣고 저장한다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });
    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());

    const fileInput = document.querySelector('#inline-attachment-note');
    const file = new File(['binary'], 'photo.png', { type: 'image/png' });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(updateIssue).toHaveBeenCalled());
    const savedNote = updateIssue.mock.calls.at(-1)[3];
    expect(savedNote.body).toContain('.issue-note-assets/issues/5/uuid-photo.png');
    expect(document.querySelector('.attachment-item')).toBeTruthy();
  });

  it('본문 링크가 사라진 파일도 명시적으로 지우기 전까지는 목록에 남기고, 저장 시점에만 링크를 되살린다', async () => {
    const linked = { name: 'linked.png', type: 'image/png', path: '.issue-note-assets/issues/5/linked.png', sha: 'sha-1', size: 10 };
    const orphan = { name: 'orphan.png', type: 'image/png', path: '.issue-note-assets/issues/5/orphan.png', sha: 'sha-2', size: 20 };
    listIssueAttachmentFiles.mockResolvedValueOnce([
      { name: linked.name, path: linked.path, sha: linked.sha, size: linked.size, url: '' },
      { name: orphan.name, path: orphan.path, sha: orphan.sha, size: orphan.size, url: '' }
    ]);
    const link = composeAttachmentLink('owner/repo', linked);
    const orphanLink = composeAttachmentLink('owner/repo', orphan);
    const issue = { ...baseIssue, body: `노트 본문\n\n${link}` };

    render(NoteEditor, { token: 't', repo: 'owner/repo', issue });

    await waitFor(() => expect(document.querySelectorAll('.attachment-item').length).toBe(2));
    const names = [...document.querySelectorAll('.attachment-name')].map((el) => el.title);
    expect(names).toEqual(['linked.png', 'orphan.png']);

    const bodyTextarea = document.querySelector('.inline-body');
    expect(bodyTextarea.value).not.toContain('orphan.png');

    await fireEvent.input(bodyTextarea, { target: { value: `${bodyTextarea.value}\n` } });
    await fireEvent.blur(bodyTextarea);

    await waitFor(() => {
      const savedNote = updateIssue.mock.calls.at(-1)[3];
      expect(savedNote.body).toContain(orphanLink);
    });
    expect(bodyTextarea.value).not.toContain('orphan.png');
  });

  it('첨부를 삭제하면 파일을 지우고 본문에서도 링크를 제거해 저장한다', async () => {
    const attachment = { name: 'linked.png', type: 'image/png', path: '.issue-note-assets/issues/5/linked.png', sha: 'sha-1', size: 10 };
    listIssueAttachmentFiles.mockResolvedValueOnce([
      { name: attachment.name, path: attachment.path, sha: attachment.sha, size: attachment.size, url: '' }
    ]);
    const link = composeAttachmentLink('owner/repo', attachment);
    const issue = { ...baseIssue, body: `노트 본문\n\n${link}` };
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(NoteEditor, { token: 't', repo: 'owner/repo', issue });
    await waitFor(() => expect(document.querySelector('.attachment-item')).toBeTruthy());

    await fireEvent.click(document.querySelector('.attachment-delete'));

    await waitFor(() => expect(deleteAttachment).toHaveBeenCalledWith(
      't', 'owner/repo', expect.objectContaining({ path: attachment.path })
    ));
    await waitFor(() => {
      const savedNote = updateIssue.mock.calls.at(-1)[3];
      expect(savedNote.body).not.toContain(link);
    });
    await waitFor(() => expect(document.querySelector('.attachment-item')).toBeNull());
    vi.unstubAllGlobals();
  });
});

describe('NoteEditor 빠른 노트 전환 레이스', () => {
  function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
  }

  it('할당 대기 중 다른 노트로 전환해 파괴된 인스턴스는 onCreated를 다시 부르지 않는다', async () => {
    localStorage.clear();
    const allocation = deferred();
    const onCreated = vi.fn();

    const { unmount, rerender } = render(NoteEditor, {
      token: 't',
      repo: 'owner/race',
      issue: null,
      initialDraft: { id: 'session-A', title: '', body: '', labels: [] },
      allocationPromise: allocation.promise,
      autoSaveSeconds: 9999,
      paused: false,
      onCreated
    });

    const bodyTextarea = document.querySelector('.inline-body');
    await fireEvent.input(bodyTextarea, { target: { value: '전환 전에 입력한 내용' } });

    // 사용자가 번호 할당 응답이 오기 전에 다른 노트로 전환한다: paused=true로
    // 바뀌면 afterUpdate가 즉시 flushRemoteSave()를 실행해 allocationPromise를
    // 기다리는 saveRemote()가 시작된다.
    await rerender({ paused: true });

    // 부모(App.svelte)가 이 사이에 번호 할당을 먼저 처리해 라우트 세그먼트를
    // note.{번호}로 바꾸면 이 NoteEditor 인스턴스는 destroy된다.
    unmount();

    // 이제서야 번호 할당 응답이 도착한다.
    allocation.resolve({ number: 42, title: '', body: '', labels: [] });

    await waitFor(() => expect(updateIssue).toHaveBeenCalled());
    // destroyed 가드가 없었다면 여기서 onCreated가 또 호출돼 부모의
    // noteCreated()가 중복 실행됐을 것이다.
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 20));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('저장 실패로 남은 새 노트 초안이 이후의 다른 새 노트로 새어나가지 않는다', async () => {
    localStorage.clear();
    updateIssue.mockRejectedValueOnce(new Error('network down'));

    const sessionA = render(NoteEditor, {
      token: 't',
      repo: 'owner/race',
      issue: null,
      initialDraft: { id: 'session-A', title: '', body: '', labels: [] },
      allocationPromise: Promise.resolve({ number: 42, title: '', body: '', labels: [] }),
      autoSaveSeconds: 9999,
      paused: false
    });

    const bodyA = document.querySelector('.inline-body');
    await fireEvent.input(bodyA, { target: { value: 'A 노트만의 내용' } });
    await fireEvent.blur(bodyA);

    await waitFor(() => expect(updateIssue).toHaveBeenCalled());
    // 저장이 실패했으므로 세션 A의 초안은 localStorage에 남는다.
    sessionA.unmount();

    render(NoteEditor, {
      token: 't',
      repo: 'owner/race',
      issue: null,
      initialDraft: { id: 'session-B', title: '', body: '', labels: [] },
      allocationPromise: Promise.resolve({ number: 43, title: '', body: '', labels: [] }),
      autoSaveSeconds: 9999,
      paused: false
    });

    const bodyB = document.querySelector('.inline-body');
    expect(bodyB.value).not.toContain('A 노트만의 내용');
  });
});
