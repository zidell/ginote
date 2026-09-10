import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import NoteEditor from './NoteEditor.svelte';
import { composeAttachmentLink } from './attachments.js';
import { MAX_ISSUE_BODY_LENGTH, MAX_ISSUE_COMMENT_LENGTH } from './github-limits.js';
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
  getIssue: vi.fn(async (token, repo, issueNumber) => ({
    number: issueNumber,
    title: '노트 제목',
    body: '노트 본문',
    labels: [],
    state: 'open',
    comments: 1,
    updated_at: '2026-09-01T00:00:00Z'
  })),
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
    state: note.state || 'open',
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
  downloadAttachment,
  getIssue,
  listIssueComments,
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
  vi.unstubAllGlobals();
});

describe('NoteEditor 코멘트 블록', () => {
  it('휴지통에서 연 닫힌 이슈는 본문을 읽기 전용으로 둔다', () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue, archived: true });

    expect(document.querySelector('.inline-body').readOnly).toBe(true);
  });

  it('저장 전에 다른 디바이스에서 닫힌 이슈를 감지하면 아니오일 때 로컬 변경을 버린다', async () => {
    const closedIssue = { ...baseIssue, state: 'closed', body: '휴지통에 있는 원격 본문' };
    const onRefreshed = vi.fn();
    getIssue.mockResolvedValueOnce(closedIssue);
    vi.stubGlobal('confirm', vi.fn(() => false));

    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      onRefreshed,
      autoSaveSeconds: 9999
    });

    const bodyTextarea = document.querySelector('.inline-body');
    await fireEvent.input(bodyTextarea, { target: { value: '이 디바이스의 수정' } });
    await fireEvent.blur(bodyTextarea);

    await waitFor(() => expect(getIssue).toHaveBeenCalledWith('t', 'owner/repo', 5));
    expect(updateIssue).not.toHaveBeenCalled();
    expect(bodyTextarea.value).toBe(closedIssue.body);
    expect(onRefreshed).toHaveBeenCalledWith(closedIssue);
  });

  it('저장 전에 다른 디바이스에서 닫힌 이슈를 감지하면 예일 때 복원과 수정을 함께 반영한다', async () => {
    getIssue.mockResolvedValueOnce({ ...baseIssue, state: 'closed' });
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999
    });

    const bodyTextarea = document.querySelector('.inline-body');
    await fireEvent.input(bodyTextarea, { target: { value: '복원하면서 저장할 본문' } });
    await fireEvent.blur(bodyTextarea);

    await waitFor(() => expect(updateIssue).toHaveBeenCalled());
    expect(updateIssue).toHaveBeenLastCalledWith(
      't',
      'owner/repo',
      5,
      expect.objectContaining({ body: '복원하면서 저장할 본문', state: 'open' }),
      expect.any(Object)
    );
  });

  it('본문과 댓글에 GitHub API 여유를 둔 입력 길이를 적용한다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());

    expect(document.querySelector('.inline-body').maxLength).toBe(MAX_ISSUE_BODY_LENGTH);
    expect(document.querySelector('.note-comment-body').maxLength).toBe(MAX_ISSUE_COMMENT_LENGTH);
    expect(MAX_ISSUE_BODY_LENGTH).toBe(58_982);
    expect(MAX_ISSUE_COMMENT_LENGTH).toBe(58_982);
  });

  it('기본 모드에서는 검색어와 치환값을 일반 문자열로 처리한다', async () => {
    localStorage.clear();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: 'a+b a+b a.b' },
      autoSaveSeconds: 9999
    });

    await fireEvent.click(document.querySelector('.detail-toolbar-replace'));
    const dialog = screen.getByRole('dialog');
    const searchInput = within(dialog).getByLabelText('Search for');
    const replaceInput = within(dialog).getByLabelText('Replace with');

    await fireEvent.input(searchInput, { target: { value: 'not-found' } });
    expect(within(dialog).getByRole('status').textContent).toContain('0 matches');
    expect(dialog.querySelector('.replace-example').classList.contains('empty')).toBe(false);
    expect(dialog.querySelector('.replace-example').textContent).toContain('not-found');

    await fireEvent.input(searchInput, { target: { value: 'a+b' } });
    expect(within(dialog).getByRole('status').textContent).toContain('2 matches');
    await fireEvent.input(replaceInput, { target: { value: '$1' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Replace' }));

    expect(document.querySelector('.inline-body').value).toBe('$1 $1 a.b');
  });

  it('정규식 모드에서는 캡처 그룹 치환 명령을 적용한다', async () => {
    localStorage.clear();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: 'foo-123 foo-456' },
      autoSaveSeconds: 9999
    });

    await fireEvent.click(document.querySelector('.detail-toolbar-replace'));
    const dialog = screen.getByRole('dialog');
    await fireEvent.input(within(dialog).getByLabelText('Search for'), {
      target: { value: '/(\\w+)-(\\d+)/' }
    });
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toContain('2 matches'));
    await fireEvent.input(within(dialog).getByLabelText('Replace with'), {
      target: { value: '$2:$1' }
    });
    await waitFor(() => expect(within(dialog).getByText(/foo-123/).textContent).toContain('123:foo'));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Replace' }));

    expect(document.querySelector('.inline-body').value).toBe('123:foo 456:foo');
  });

  it('첨부 링크의 내부 {repo} 토큰은 치환 대상에서 제외한다', async () => {
    localStorage.clear();
    const attachmentLink = composeAttachmentLink('owner/repo', {
      name: 'plan.pdf',
      type: 'application/pdf',
      path: '.issue-note-assets/issues/5/plan.pdf'
    });
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: `repo\n\n${attachmentLink}` },
      autoSaveSeconds: 9999
    });

    await fireEvent.click(document.querySelector('.detail-toolbar-replace'));
    const dialog = screen.getByRole('dialog');
    await fireEvent.input(within(dialog).getByLabelText('Search for'), {
      target: { value: 'repo' }
    });
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toContain('1 matches'));
    await fireEvent.input(within(dialog).getByLabelText('Replace with'), {
      target: { value: 'project' }
    });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Replace' }));

    expect(document.querySelector('.inline-body').value).toBe(
      'project\n\n[]({repo}/.issue-note-assets/issues/5/plan.pdf)'
    );
  });

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

  it('노트를 떠날 때 본문과 댓글에 남은 저장 작업을 함께 flush한다', async () => {
    localStorage.clear();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999
    });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
    const bodyTextarea = document.querySelector('.inline-body');
    const commentBody = document.querySelector('.note-comment-body');
    await fireEvent.input(bodyTextarea, { target: { value: '이탈 전 본문' } });
    await fireEvent.input(commentBody, { target: { value: '이탈 전 댓글' } });

    window.dispatchEvent(new Event('pagehide'));

    await waitFor(() => expect(updateIssue).toHaveBeenCalledWith(
      't',
      'owner/repo',
      5,
      expect.objectContaining({ body: '이탈 전 본문' }),
      expect.any(Object)
    ));
    await waitFor(() => expect(updateIssueComment).toHaveBeenCalledWith(
      't',
      'owner/repo',
      1,
      '이탈 전 댓글'
    ));
  });

  it('본문에서 Ctrl+S를 누르면 대기 상태에서도 기본 동작을 막고 즉시 저장한다', async () => {
    localStorage.clear();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      paused: true,
      autoSaveSeconds: 9999
    });

    const bodyTextarea = document.querySelector('.inline-body');
    await fireEvent.input(bodyTextarea, { target: { value: 'Ctrl+S로 저장한 본문' } });

    const event = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    bodyTextarea.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(updateIssue).toHaveBeenCalledWith(
      't',
      'owner/repo',
      5,
      expect.objectContaining({ body: 'Ctrl+S로 저장한 본문' }),
      expect.any(Object)
    ));
  });

  it('댓글에서 Cmd+S를 누르면 기본 동작을 막고 즉시 저장한다', async () => {
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      paused: true,
      autoSaveSeconds: 9999
    });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
    const commentBody = document.querySelector('.note-comment-body');
    await fireEvent.input(commentBody, { target: { value: 'Cmd+S로 저장한 댓글' } });

    const event = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      metaKey: true,
      bubbles: true,
      cancelable: true
    });
    commentBody.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(updateIssueComment).toHaveBeenCalledWith(
      't',
      'owner/repo',
      1,
      'Cmd+S로 저장한 댓글'
    ));
  });

  it('본문에서 여러 줄의 일부만 선택해도 Tab과 Shift+Tab을 줄 단위로 적용한다', () => {
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: 'one\n two\nthree' }
    });

    const bodyTextarea = document.querySelector('.inline-body');
    bodyTextarea.focus();
    bodyTextarea.setSelectionRange(1, 10);

    const indentEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      bubbles: true,
      cancelable: true
    });
    bodyTextarea.dispatchEvent(indentEvent);

    expect(indentEvent.defaultPrevented).toBe(true);
    expect(bodyTextarea.value).toBe('\tone\n\t two\n\tthree');
    expect(bodyTextarea.selectionStart).toBe(2);
    expect(bodyTextarea.selectionEnd).toBe(13);

    const outdentEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    bodyTextarea.dispatchEvent(outdentEvent);

    expect(outdentEvent.defaultPrevented).toBe(true);
    expect(bodyTextarea.value).toBe('one\n two\nthree');
    expect(bodyTextarea.selectionStart).toBe(1);
    expect(bodyTextarea.selectionEnd).toBe(10);
  });

  it('여러 줄 선택이 아닌 Tab은 textarea의 기본 동작을 유지한다', () => {
    localStorage.clear();
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    const bodyTextarea = document.querySelector('.inline-body');
    bodyTextarea.setSelectionRange(0, 1);
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      bubbles: true,
      cancelable: true
    });
    bodyTextarea.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(bodyTextarea.value).toBe(baseIssue.body);
  });

  it('선택 시작 줄의 들여쓰기를 제거해도 선택 시작점이 이전 줄로 이동하지 않는다', () => {
    localStorage.clear();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: 'before\n\tone\n\ttwo\nafter' }
    });

    const bodyTextarea = document.querySelector('.inline-body');
    bodyTextarea.focus();
    bodyTextarea.setSelectionRange(7, 16);

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    bodyTextarea.dispatchEvent(event);

    expect(bodyTextarea.value).toBe('before\none\ntwo\nafter');
    expect(bodyTextarea.selectionStart).toBe(7);
    expect(bodyTextarea.selectionEnd).toBe(14);
  });

  it('변경사항이 없어도 본문에서 Ctrl+S를 누르면 현재 본문을 강제 저장한다', async () => {
    localStorage.clear();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999
    });

    const bodyTextarea = document.querySelector('.inline-body');
    const event = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    bodyTextarea.dispatchEvent(event);

    await waitFor(() => expect(updateIssue).toHaveBeenCalledWith(
      't',
      'owner/repo',
      5,
      expect.objectContaining({ body: baseIssue.body }),
      expect.any(Object)
    ));
  });

  it('변경사항이 없어도 댓글에서 Cmd+S를 누르면 현재 댓글을 강제 저장한다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue, autoSaveSeconds: 9999 });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
    const commentBody = document.querySelector('.note-comment-body');
    const event = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      metaKey: true,
      bubbles: true,
      cancelable: true
    });
    commentBody.dispatchEvent(event);

    await waitFor(() => expect(updateIssueComment).toHaveBeenCalledWith(
      't',
      'owner/repo',
      1,
      '댓글 내용'
    ));
  });

  it('본문 저장 요청이 이미 진행 중이면 같은 내용의 Ctrl+S는 중복 요청하지 않는다', async () => {
    localStorage.clear();
    let release;
    const inFlight = new Promise((resolve) => { release = resolve; });
    updateIssue.mockImplementationOnce(async (token, repo, issueNumber, note) => {
      await inFlight;
      return {
        number: issueNumber,
        title: note.title,
        body: note.body,
        labels: (note.labels || []).map((name) => ({ name })),
        comments: 0,
        updated_at: '2026-09-06T00:00:00Z'
      };
    });

    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999
    });

    const bodyTextarea = document.querySelector('.inline-body');
    await fireEvent.input(bodyTextarea, { target: { value: '진행 중인 저장' } });
    const shortcut = () => bodyTextarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    }));

    shortcut();
    await waitFor(() => expect(updateIssue).toHaveBeenCalledTimes(1));
    shortcut();
    expect(updateIssue).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(document.querySelector('.save-status.is-visible')).toBeNull());
  });

  it('본문과 댓글이 모두 변경돼도 현재 포커스가 있는 항목만 저장한다', async () => {
    localStorage.clear();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999
    });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
    const bodyTextarea = document.querySelector('.inline-body');
    const commentBody = document.querySelector('.note-comment-body');
    await fireEvent.input(bodyTextarea, { target: { value: '본문만 먼저 저장' } });
    await fireEvent.input(commentBody, { target: { value: '댓글은 아직 저장하지 않음' } });

    const event = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    bodyTextarea.dispatchEvent(event);

    await waitFor(() => expect(updateIssue).toHaveBeenCalled());
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

describe('NoteEditor 마크다운 프리뷰와 단축키', () => {
  function dispatchShortcut(key, code = '') {
    const event = new KeyboardEvent('keydown', {
      key,
      code,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(event);
    return event;
  }

  it('더보기 메뉴의 MD뷰어로 안전하게 렌더링한다', async () => {
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: '# 제목\n\n**강조**\n\n<script>alert(1)</script>' }
    });

    await fireEvent.click(document.querySelector('.detail-toolbar-more > button'));
    await fireEvent.click(screen.getByRole('button', { name: 'MD viewer M' }));

    await waitFor(() => expect(document.querySelector('.markdown-preview')).toBeTruthy());
    expect(document.querySelector('.markdown-preview h1').textContent).toBe('제목');
    expect(document.querySelector('.markdown-preview strong').textContent).toBe('강조');
    expect(document.querySelector('.markdown-preview').innerHTML).not.toContain('<script');
  });

  it('MD뷰어에서는 편집기용 {repo} 첨부 주소를 실제 URL로 복원한다', async () => {
    const path = '.issue-note-assets/issues/5/photo.png';
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: `![]({repo}/${path})` }
    });

    await fireEvent.click(document.querySelector('.detail-toolbar-more > button'));
    await fireEvent.click(screen.getByRole('button', { name: 'MD viewer M' }));

    await waitFor(() => expect(document.querySelector('.markdown-preview img')).toBeTruthy());
    expect(document.querySelector('.markdown-preview img').getAttribute('src'))
      .toBe(`https://github.com/owner/repo/raw/HEAD/${path}`);
  });

  it('private 저장소 첨부 이미지는 인증된 미리보기 URL로 렌더링한다', async () => {
    const attachment = {
      name: 'photo.png',
      path: '.issue-note-assets/issues/5/photo.png',
      sha: 'sha-photo',
      size: 10,
      url: ''
    };
    listIssueAttachmentFiles.mockResolvedValueOnce([attachment]);
    downloadAttachment.mockResolvedValueOnce(new Blob(['image'], { type: 'image/png' }));
    const issue = { ...baseIssue, body: composeAttachmentLink('owner/repo', { ...attachment, type: 'image/png' }) };
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue });

    await waitFor(() => expect(downloadAttachment).toHaveBeenCalledWith(
      't', 'owner/repo', expect.objectContaining({ path: attachment.path })
    ));
    dispatchShortcut('m', 'KeyM');

    await waitFor(() => expect(document.querySelector('.markdown-preview img')).toBeTruthy());
    expect(document.querySelector('.markdown-preview img').getAttribute('src')).toBe('blob:mock');
  });

  it('MD뷰어에서 코멘트도 Markdown으로 안전하게 렌더링한다', async () => {
    listIssueComments.mockResolvedValueOnce([{
      id: 7,
      body: '**댓글 강조**\n\n<script>alert(1)</script>',
      author: 'octocat',
      avatarUrl: '',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      url: ''
    }]);
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    await fireEvent.click(document.querySelector('.detail-toolbar-more > button'));
    await fireEvent.click(screen.getByRole('button', { name: 'MD viewer M' }));

    await waitFor(() => expect(document.querySelector('.note-comment-body-preview strong')).toBeTruthy());
    expect(document.querySelector('.note-comment-body-preview').innerHTML).not.toContain('<script');
  });

  it('포커스가 없을 때 M으로 열고 같은 키나 Escape로 닫는다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    const openEvent = dispatchShortcut('m', 'KeyM');
    expect(openEvent.defaultPrevented).toBe(true);
    await waitFor(() => expect(document.querySelector('.markdown-preview')).toBeTruthy());

    const toggleEvent = dispatchShortcut('m', 'KeyM');
    expect(toggleEvent.defaultPrevented).toBe(true);
    await waitFor(() => expect(document.querySelector('.markdown-preview')).toBeNull());

    dispatchShortcut('m', 'KeyM');
    await waitFor(() => expect(document.querySelector('.markdown-preview')).toBeTruthy());
    const escapeEvent = dispatchShortcut('Escape');
    expect(escapeEvent.defaultPrevented).toBe(true);
    await waitFor(() => expect(document.querySelector('.markdown-preview')).toBeNull());
  });

  it('본문에 포커스가 있으면 M을 입력 단축키로 가로채지 않는다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    const body = document.querySelector('.inline-body');
    body.focus();
    const event = dispatchShortcut('m', 'KeyM');

    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('.markdown-preview')).toBeNull();
  });

  it('버튼에 포커스가 있어도 단일 키 단축키를 처리한다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    const toolbarButton = document.querySelector('.detail-toolbar-more > button');
    toolbarButton.focus();
    const event = dispatchShortcut('m', 'KeyM');

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(document.querySelector('.markdown-preview')).toBeTruthy());
  });

  it('프리뷰 전환 전후에 스크롤 진행률을 서로 변환한다', async () => {
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: '# 제목\n\n본문' }
    });

    const scroll = document.querySelector('.inline-editor-scroll');
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(scroll, 'scrollHeight', {
      configurable: true,
      get: () => document.querySelector('.markdown-preview') ? 500 : 1000
    });
    scroll.scrollTop = 450;

    dispatchShortcut('m', 'KeyM');
    await waitFor(() => expect(document.querySelector('.markdown-preview')).toBeTruthy());
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(scroll.scrollTop).toBe(200);

    scroll.scrollTop = 100;
    dispatchShortcut('m', 'KeyM');
    await waitFor(() => expect(document.querySelector('.markdown-preview')).toBeNull());
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(scroll.scrollTop).toBe(225);
  });

  it('프리뷰 진입 시 모든 이미지가 렌더된 뒤 최종 높이로 스크롤을 맞춘다', async () => {
    let imageReady = [false, false];
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: {
        ...baseIssue,
        body: '![](https://example.com/first.png)\n\n![](https://example.com/second.png)'
      }
    });

    const scroll = document.querySelector('.inline-editor-scroll');
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(scroll, 'scrollHeight', {
      configurable: true,
      get: () => document.querySelector('.markdown-preview')
        ? (imageReady.every(Boolean) ? 900 : 500)
        : 1000
    });
    scroll.scrollTop = 450;

    dispatchShortcut('m', 'KeyM');
    await waitFor(() => expect(document.querySelectorAll('.markdown-preview img').length).toBe(2));
    const images = [...document.querySelectorAll('.markdown-preview img')];
    images.forEach((image, index) => {
      Object.defineProperty(image, 'complete', {
        configurable: true,
        get: () => imageReady[index]
      });
    });

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(scroll.scrollTop).toBe(450);

    imageReady[0] = true;
    images[0].dispatchEvent(new Event('load'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(scroll.scrollTop).toBe(450);

    imageReady[1] = true;
    images[1].dispatchEvent(new Event('load'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(scroll.scrollTop).toBe(400);
  });

  it('포커스가 없을 때 R로 앱 전체를 새로고침한다', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    const event = dispatchShortcut('r', 'KeyR');

    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('포커스가 없을 때 S로 현재 노트를 저장한다', async () => {
    localStorage.clear();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999
    });

    const bodyTextarea = document.querySelector('.inline-body');
    await fireEvent.input(bodyTextarea, { target: { value: '포커스 없이 저장한 본문' } });
    const event = dispatchShortcut('s', 'KeyS');

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(updateIssue).toHaveBeenCalledWith(
      't',
      'owner/repo',
      5,
      expect.objectContaining({ body: '포커스 없이 저장한 본문' }),
      expect.any(Object)
    ));
  });

  it('포커스가 없을 때 t, a, p, l, Delete, g 단축키를 툴바 동작에 연결한다', async () => {
    const onTogglePin = vi.fn();
    const onMove = vi.fn();
    const issue = { ...baseIssue, html_url: 'https://github.com/owner/repo/issues/5' };
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue,
      availableLabels: [{ name: 'work' }],
      onTogglePin,
      onMove
    });

    const fileInput = document.querySelector('#inline-attachment-note');
    const clickSpy = vi.spyOn(fileInput, 'click');
    const issueLink = [...document.querySelectorAll('.detail-toolbar-more a')]
      .find((link) => link.href === issue.html_url);
    const issueLinkSpy = vi.spyOn(issueLink, 'click');

    dispatchShortcut('t', 'KeyT');
    await waitFor(() => expect(document.querySelector('.tag-dropdown input')).toBeTruthy());
    document.activeElement.blur();
    dispatchShortcut('a', 'KeyA');
    dispatchShortcut('p', 'KeyP');
    dispatchShortcut('l', 'KeyL');
    dispatchShortcut('Delete', 'Delete');
    dispatchShortcut('g', 'KeyG');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.querySelector('.note-lock-panel')).toBeTruthy());
    expect(onMove).toHaveBeenCalledWith(issue);
    expect(issueLinkSpy).toHaveBeenCalledTimes(1);
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

  it('첨부를 삭제 예약하고 5초 뒤 파일과 본문 링크를 함께 삭제한다', async () => {
    const attachment = { name: 'linked.png', type: 'image/png', path: '.issue-note-assets/issues/5/linked.png', sha: 'sha-1', size: 10 };
    listIssueAttachmentFiles.mockResolvedValueOnce([
      { name: attachment.name, path: attachment.path, sha: attachment.sha, size: attachment.size, url: '' }
    ]);
    const link = composeAttachmentLink('owner/repo', attachment);
    const issue = { ...baseIssue, body: `노트 본문\n\n${link}` };
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue });
    await waitFor(() => expect(document.querySelector('.attachment-item')).toBeTruthy());

    vi.useFakeTimers();
    try {
      await fireEvent.click(document.querySelector('.attachment-delete'));

      expect(deleteAttachment).not.toHaveBeenCalled();
      expect(document.querySelector('.attachment-pending-delete').textContent).toContain('Deleting…');
      expect(document.querySelector('.attachment-pending-delete .attachment-spinner')).toBeTruthy();

      await vi.advanceTimersByTimeAsync(5000);

      await waitFor(() => expect(deleteAttachment).toHaveBeenCalledWith(
        't', 'owner/repo', expect.objectContaining({ path: attachment.path })
      ));
      await waitFor(() => {
        const savedNote = updateIssue.mock.calls.at(-1)[3];
        expect(savedNote.body).not.toContain(link);
      });
      await waitFor(() => expect(document.querySelector('.attachment-item')).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it('첨부 삭제 예약은 5초 안에 취소할 수 있다', async () => {
    const attachment = { name: 'cancel.png', type: 'image/png', path: '.issue-note-assets/issues/5/cancel.png', sha: 'sha-cancel', size: 10 };
    listIssueAttachmentFiles.mockResolvedValueOnce([
      { name: attachment.name, path: attachment.path, sha: attachment.sha, size: attachment.size, url: '' }
    ]);

    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: `노트 본문\n\n${composeAttachmentLink('owner/repo', attachment)}` }
    });
    await waitFor(() => expect(document.querySelector('.attachment-item')).toBeTruthy());

    await fireEvent.click(document.querySelector('.attachment-delete'));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(document.querySelector('.attachment-pending-delete')).toBeNull();
    expect(deleteAttachment).not.toHaveBeenCalled();
  });
});

describe('NoteEditor 태그', () => {
  it('pin 시스템 라벨은 숨기고 저장할 때는 보존한다', async () => {
    const issue = {
      ...baseIssue,
      labels: [{ name: 'work' }, { name: 'ginote:pin' }]
    };
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue,
      availableLabels: [{ name: 'work' }, { name: 'ginote:pin' }],
      pinned: true,
      autoSaveSeconds: 9999
    });

    expect(screen.getByText('#work')).toBeTruthy();
    expect(screen.queryByText('#ginote:pin')).toBeNull();

    await fireEvent.input(document.querySelector('.inline-body'), { target: { value: '수정한 본문' } });
    await fireEvent.blur(document.querySelector('.inline-body'));
    await waitFor(() => expect(updateIssue).toHaveBeenCalled());

    const savedNote = updateIssue.mock.calls.at(-1)[3];
    expect(savedNote.labels).toContain('ginote:pin');
  });

  it('이미 붙은 태그를 선택기에서 다시 누르면 제거한다', async () => {
    const issue = { ...baseIssue, labels: [{ name: 'Work' }] };
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue,
      availableLabels: [{ name: 'work' }],
      ignoreRecoveredDraft: true,
      autoSaveSeconds: 9999
    });

    const pickerButton = document.querySelector('.detail-toolbar-actions-desktop .tag-picker > button');
    await fireEvent.click(pickerButton);

    const option = screen.getByRole('button', { name: '#work' });
    expect(option.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(option);

    expect(document.querySelector('.editor-tag')).toBeNull();
  });

  it('본문 상단의 태그를 누르면 해당 태그를 검색하고 X 버튼으로 제거한다', async () => {
    const issue = { ...baseIssue, labels: [{ name: 'work' }] };
    const onTagSelect = vi.fn();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue,
      availableLabels: [{ name: 'work' }],
      onTagSelect,
      ignoreRecoveredDraft: true,
      autoSaveSeconds: 9999
    });

    const tag = document.querySelector('.editor-tag');
    const tagLink = screen.getByRole('button', { name: '#work' });
    const removeButton = screen.getByRole('button', { name: 'Remove tag work' });
    expect(removeButton.querySelector('i.bi-x')).toBeTruthy();

    await fireEvent.click(tagLink);
    expect(onTagSelect).toHaveBeenCalledWith('work');
    expect(document.querySelector('.editor-tag')).toBe(tag);

    await fireEvent.click(removeButton);

    expect(document.querySelector('.editor-tag')).toBeNull();
  });

  it('MD뷰어에서는 본문 상단 태그를 읽기 전용으로 보여준다', async () => {
    const issue = { ...baseIssue, labels: [{ name: 'work' }] };
    const onTagSelect = vi.fn();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue,
      availableLabels: [{ name: 'work' }],
      onTagSelect,
      ignoreRecoveredDraft: true,
      autoSaveSeconds: 9999
    });

    await fireEvent.click(document.querySelector('.detail-toolbar-more > button'));
    await fireEvent.click(screen.getByRole('button', { name: 'MD viewer M' }));
    await waitFor(() => expect(document.querySelector('.markdown-preview')).toBeTruthy());

    const tag = document.querySelector('.editor-tags .editor-tag');
    expect(tag.tagName).toBe('SPAN');
    expect(tag.querySelector('.editor-tag-remove')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '#work' }));
    expect(onTagSelect).toHaveBeenCalledWith('work');
    expect(document.querySelector('.editor-tags .editor-tag')).toBe(tag);
  });

  it('인라인 선택기에서 마지막 태그를 빼도 열린 드롭다운은 유지한다', async () => {
    const issue = { ...baseIssue, labels: [{ name: 'Work' }] };
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue,
      availableLabels: [{ name: 'work' }],
      ignoreRecoveredDraft: true,
      autoSaveSeconds: 9999
    });

    await waitFor(() => expect(document.querySelector('.editor-tags .tag-picker > button')).toBeTruthy());
    const pickerButton = document.querySelector('.editor-tags .tag-picker > button');
    await fireEvent.click(pickerButton);
    await fireEvent.click(screen.getByRole('button', { name: '#work' }));

    expect(document.querySelector('.editor-tag')).toBeNull();
    expect(document.querySelector('.editor-tags')).toBeTruthy();
    expect(document.querySelector('.editor-tags .tag-dropdown')).toBeTruthy();

    await fireEvent.pointerDown(document.body);
    expect(document.querySelector('.editor-tags')).toBeNull();
  });

  it('인라인 태그 검색창에서 Escape를 누르면 포커스와 드롭다운을 함께 닫는다', async () => {
    const issue = { ...baseIssue, labels: [{ name: 'Work' }] };
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue,
      availableLabels: [{ name: 'work' }],
      ignoreRecoveredDraft: true,
      autoSaveSeconds: 9999
    });

    await waitFor(() => expect(document.querySelector('.editor-tags .tag-picker > button')).toBeTruthy());
    await fireEvent.click(document.querySelector('.editor-tags .tag-picker > button'));
    const input = document.querySelector('.editor-tags .tag-dropdown input');
    expect(input).toBeTruthy();
    input.focus();

    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(document.activeElement).not.toBe(input);
    expect(document.querySelector('.editor-tags .tag-dropdown')).toBeNull();
  });
});

describe('NoteEditor 상단 고정', () => {
  it('고정할 때 부모에 현재 편집 중인 제목과 본문을 전달한다', async () => {
    const onTogglePin = vi.fn();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      titleMode: 'separate',
      onTogglePin
    });

    const titleInput = document.querySelector('.inline-title');
    await fireEvent.input(titleInput, { target: { value: '고정 직전 제목' } });
    const pinButton = [...document.querySelectorAll('.dropdown-item')]
      .find((button) => button.textContent.includes('상단고정'));
    await fireEvent.click(pinButton);

    expect(onTogglePin).toHaveBeenCalledWith(expect.objectContaining({
      title: '고정 직전 제목',
      body: baseIssue.body
    }));
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
