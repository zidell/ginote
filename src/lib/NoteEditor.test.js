import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import NoteEditor from './NoteEditor.svelte';
import LockSessionHost from './__fixtures__/LockSessionHost.svelte';
import { composeAttachmentLink, withManagedAttachmentBlock } from './attachments.js';
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
  listAllIssueAttachmentFiles: vi.fn(async () => []),
  listIssueCommentAttachmentFiles: vi.fn(async () => []),
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
  uploadAttachment: vi.fn(async (token, repo, issueNumber, file, commentId = null) => ({
    name: file.name,
    type: file.type,
    path: `.issue-note-assets/issues/${issueNumber}${commentId ? `/comments/${commentId}` : ''}/uuid-${file.name}`,
    sha: 'file-sha',
    size: file.size,
    url: 'https://github.com/file'
  }))
}));

// 실제 잠금 암호화는 PBKDF2 60만 회라 테스트마다 돌리기엔 느리다. 편집기가 PIN과
// 이슈 번호를 올바르게 넘기는지만 보면 되므로 내용을 그대로 드러내는 가짜로 바꾼다.
vi.mock('./note-lock.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isLockedPayload: (value) => String(value ?? '').startsWith('enc|'),
  encryptLockedBody: vi.fn(async (body, pin, issueNumber) => `enc|${pin}|${issueNumber}|${body}`),
  decryptLockedBody: vi.fn(async (body, pin, issueNumber) => {
    const [marker, storedPin, storedNumber, ...rest] = String(body).split('|');
    if (marker !== 'enc' || storedPin !== pin || Number(storedNumber) !== issueNumber) {
      throw new Error('6자리 숫자가 맞지 않습니다.');
    }
    return rest.join('|');
  })
}));

const { decryptLockedBody, encryptLockedBody } = await import('./note-lock.js');

const {
  createLabel,
  createIssueComment,
  deleteAttachment,
  deleteIssueComment,
  downloadAttachment,
  getIssue,
  listAllIssueAttachmentFiles,
  listIssueCommentAttachmentFiles,
  listIssueComments,
  listIssueAttachmentFiles,
  updateIssue,
  updateIssueComment,
  uploadAttachment
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

  it('음성 전사문은 선택 영역과 무관하게 본문 끝 빈 줄 뒤에 추가한다', async () => {
    const onVoiceBodyHandled = vi.fn();
    const { rerender, container, unmount } = render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: '앞선택뒤' },
      autoSaveSeconds: 9999,
      onVoiceBodyHandled
    });

    await rerender({ voiceBody: {
      id: 1,
      issueNumber: 5,
      selectionStart: 1,
      selectionEnd: 3,
      body: '음성'
    } });

    await waitFor(() => expect(container.querySelector('.inline-body').value).toBe('앞선택뒤\n\n음성'));
    expect(onVoiceBodyHandled).toHaveBeenCalledWith(1);
    unmount();
  });

  it('본문 음성 녹음은 커서 위치와 무관하게 끝에 추가하도록 요청한다', async () => {
    localStorage.clear();
    const onVoiceRecording = vi.fn();
    const { rerender, container } = render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: '기존 본문\n' },
      autoSaveSeconds: 9999,
      onVoiceRecording
    });

    const moreButton = screen.getByRole('button', { name: 'More note actions' });
    await fireEvent.click(moreButton);
    const voiceButton = [...document.querySelectorAll('.detail-toolbar-voice')].at(-1);
    await fireEvent.click(voiceButton);
    expect(onVoiceRecording).toHaveBeenCalledWith(expect.objectContaining({ number: 5 }), expect.objectContaining({
      type: 'body'
    }));

    await rerender({ voiceBody: {
      id: 1,
      issueNumber: 5,
      body: '전사문'
    } });

    await waitFor(() => expect([...container.querySelectorAll('.inline-body')].at(-1).value).toBe('기존 본문\n\n전사문'));
  });

  it('음성 전사문은 자동저장 시간을 기다리지 않고 즉시 저장한다', async () => {
    localStorage.clear();
    const { rerender } = render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: '기존 본문' },
      autoSaveSeconds: 9999
    });

    // 외부 녹음 화면이 닫힌 뒤 전달되는 전사문을 흉내 낸다.
    await rerender({ voiceBody: {
      id: 1,
      issueNumber: 5,
      body: '추가 전사문'
    } });

    await waitFor(() => expect(updateIssue).toHaveBeenCalledWith(
      't',
      'owner/repo',
      5,
      expect.objectContaining({ body: '기존 본문\n\n추가 전사문' }),
      expect.any(Object)
    ));
  });

  it('목록으로 즉시 돌아가도 편집기 파괴 뒤 백그라운드 저장 결과를 목록에 알린다', async () => {
    localStorage.clear();
    let resolveUpdate;
    updateIssue.mockImplementationOnce((token, repo, issueNumber, note) => new Promise((resolve) => {
      resolveUpdate = () => resolve({
        number: issueNumber,
        title: note.title,
        body: note.body,
        labels: [],
        state: 'open',
        comments: 0,
        updated_at: '2026-09-06T00:00:00Z'
      });
    }));
    const onBack = vi.fn();
    const onSaved = vi.fn();
    const { unmount } = render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999,
      onBack,
      onSaved
    });

    await fireEvent.input(document.querySelector('.inline-body'), { target: { value: '목록 뒤에도 남을 본문' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

    expect(onBack).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(updateIssue).toHaveBeenCalled());
    unmount();
    resolveUpdate();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ body: '목록 뒤에도 남을 본문' }),
      null
    ));
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

  it('댓글 내용이 늘거나 줄 때 textarea 높이를 내용에 맞춘다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
    const commentBody = document.querySelector('.note-comment-body');
    let contentHeight = 96;
    Object.defineProperty(commentBody, 'scrollHeight', {
      configurable: true,
      get() {
        if (commentBody.style.height === 'auto') return contentHeight;
        return Math.max(contentHeight, Number.parseFloat(commentBody.style.height) || 0);
      }
    });

    await fireEvent.input(commentBody, { target: { value: '여러 줄로 길어진 댓글' } });
    expect(commentBody.style.height).toBe('96px');

    contentHeight = 32;
    await fireEvent.input(commentBody, { target: { value: '짧은 댓글' } });
    expect(commentBody.style.height).toBe('32px');

    await fireEvent.blur(commentBody);
    await waitFor(() => expect(updateIssueComment).toHaveBeenCalledWith('t', 'owner/repo', 1, '짧은 댓글'));
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

  it('한 줄의 일부만 선택해도 Tab과 Shift+Tab을 줄 단위로 적용한다', () => {
    localStorage.clear();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: { ...baseIssue, body: 'before\n one line\nafter' }
    });

    const bodyTextarea = document.querySelector('.inline-body');
    bodyTextarea.focus();
    bodyTextarea.setSelectionRange(9, 14);

    const indentEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      bubbles: true,
      cancelable: true
    });
    bodyTextarea.dispatchEvent(indentEvent);

    expect(indentEvent.defaultPrevented).toBe(true);
    expect(bodyTextarea.value).toBe('before\n\t one line\nafter');
    expect(bodyTextarea.selectionStart).toBe(10);
    expect(bodyTextarea.selectionEnd).toBe(15);

    const outdentEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    bodyTextarea.dispatchEvent(outdentEvent);

    expect(outdentEvent.defaultPrevented).toBe(true);
    expect(bodyTextarea.value).toBe('before\n one line\nafter');
    expect(bodyTextarea.selectionStart).toBe(9);
    expect(bodyTextarea.selectionEnd).toBe(14);
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

  it('댓글 삭제는 3초 동안 취소할 수 있고, 그 뒤에만 요청한다', async () => {
    vi.useFakeTimers();
    try {
      render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

      await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
      await fireEvent.click(document.querySelector('.note-comment-item li:last-child .dropdown-item'));

      expect(document.querySelector('.comment-deletion-overlay')).toBeTruthy();
      expect(deleteIssueComment).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(3000);
      await waitFor(() => expect(deleteIssueComment).toHaveBeenCalledWith('t', 'owner/repo', 1));
      expect(document.querySelector('.note-comment-item')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('댓글 삭제 대기 중 취소하면 삭제 요청을 보내지 않는다', async () => {
    vi.useFakeTimers();
    try {
      render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

      await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());
      await fireEvent.click(document.querySelector('.note-comment-item li:last-child .dropdown-item'));
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await vi.advanceTimersByTimeAsync(3000);

      expect(deleteIssueComment).not.toHaveBeenCalled();
      expect(document.querySelector('.note-comment-item')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('댓글을 삭제하면 다른 곳에서 참조하지 않는 댓글 첨부도 정리한다', async () => {
    const attachment = {
      name: 'comment.txt',
      path: '.issue-note-assets/issues/5/comments/1/uuid-comment.txt',
      sha: 'comment-sha',
      size: 4,
      url: ''
    };
    listIssueCommentAttachmentFiles.mockResolvedValueOnce([attachment]);
    listAllIssueAttachmentFiles.mockResolvedValueOnce([attachment]);
    vi.useFakeTimers();
    try {
      render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

      await waitFor(() => expect(document.querySelector('.note-comment-item .attachment-name')).toBeTruthy());
      await fireEvent.click(document.querySelector('.note-comment-item li:last-child .dropdown-item'));
      await vi.advanceTimersByTimeAsync(3000);

      await waitFor(() => expect(deleteIssueComment).toHaveBeenCalledWith('t', 'owner/repo', 1));
      await waitFor(() => expect(deleteAttachment).toHaveBeenCalledWith('t', 'owner/repo', attachment));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('NoteEditor 툴바 이슈 번호', () => {
  it('이슈 번호와 날짜를 공백으로 띄워 붙어 보이지 않게 한다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    const numberButton = document.querySelector('.toolbar-issue-number');
    expect(numberButton.textContent).toBe('#5');
    // 공백이 없으면 "#52026-09-01"처럼 번호와 연도가 붙어 버린다.
    expect(numberButton.parentElement.textContent.trim()).toBe('#5 2026-09-01');
  });

  it('이슈 번호를 클릭하면 "Issue(#번호) : 제목"을 복사하고, 실패하면 오류를 보여준다', async () => {
    const writeText = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });
    const numberButton = document.querySelector('.toolbar-issue-number');

    await fireEvent.click(numberButton);
    expect(writeText).toHaveBeenCalledWith('Issue(#5) : 노트 제목');
    await waitFor(() => expect(numberButton.classList.contains('is-copied')).toBe(true));
    expect(screen.queryByText('Could not copy to the clipboard.')).toBeNull();

    await fireEvent.click(numberButton);
    await waitFor(() => expect(screen.getByText('Could not copy to the clipboard.')).toBeTruthy());
  });

  it('제목이 비어 있으면 번호만 복사한다', async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: { ...baseIssue, title: '   ' } });

    await fireEvent.click(document.querySelector('.toolbar-issue-number'));
    expect(writeText).toHaveBeenCalledWith('Issue(#5)');
  });

  it('복사 표시는 잠시 뒤 사라진다', async () => {
    vi.useFakeTimers();
    try {
      const writeText = vi.fn().mockResolvedValue();
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });
      const numberButton = document.querySelector('.toolbar-issue-number');

      await fireEvent.click(numberButton);
      await vi.advanceTimersByTimeAsync(0);
      expect(numberButton.classList.contains('is-copied')).toBe(true);

      await vi.advanceTimersByTimeAsync(1500);
      expect(numberButton.classList.contains('is-copied')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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
    const closeButton = screen.getByRole('button', { name: 'Close (M)' });
    expect(closeButton).toBeTruthy();
    expect(closeButton.querySelector('.shortcut-key').classList.contains('is-available')).toBe(true);
    expect(document.querySelector('.detail-toolbar-actions-desktop')).toBeNull();
    expect(document.querySelector('.detail-toolbar-actions-mobile')).toBeNull();
    expect(document.querySelector('.note-content').classList.contains('markdown-preview-mode')).toBe(true);
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
      .toBe(`https://github.com/owner/repo/raw/ginote-assets/${path}`);
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

  it('자동 관리 첨부 링크가 있으면 파일 목록 전부터 첨부 영역을 표시한다', async () => {
    let resolveFiles;
    listIssueAttachmentFiles.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFiles = resolve;
    }));
    const attachment = {
      name: 'photo.png',
      path: '.issue-note-assets/issues/5/photo.png',
      type: 'image/png'
    };
    const secondAttachment = {
      name: 'document.pdf',
      path: '.issue-note-assets/issues/5/document.pdf',
      type: 'application/pdf'
    };
    const issue = {
      ...baseIssue,
      body: `<!-- ginote:attachments:start -->\n\n${composeAttachmentLink('owner/repo', attachment)}\n\n<!-- ginote:attachments:end -->\n\n노트 본문\n\n${composeAttachmentLink('owner/repo', secondAttachment)}`
    };
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue });

    await waitFor(() => expect(listIssueAttachmentFiles).toHaveBeenCalledWith('t', 'owner/repo', 5));
    expect(document.querySelector('.attachment-section')).toBeTruthy();
    expect(document.querySelectorAll('.attachment-loading-placeholder')).toHaveLength(2);

    resolveFiles([]);
    await waitFor(() => expect(document.querySelectorAll('.attachment-loading-placeholder')).toHaveLength(0));
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

  it('상단 중앙의 닫기 (M) 버튼으로 MD뷰어를 닫는다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    dispatchShortcut('m', 'KeyM');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close (M)' })).toBeTruthy());

    await fireEvent.click(screen.getByRole('button', { name: 'Close (M)' }));

    await waitFor(() => expect(document.querySelector('.markdown-preview')).toBeNull());
    expect(document.querySelector('.note-content').classList.contains('markdown-preview-mode')).toBe(false);
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

  it('첨부 A가 가능할 때 태그 T도 같은 툴바 상태로 표시한다', () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    const tagShortcut = document.querySelector('.detail-toolbar-actions-desktop .tag-picker .shortcut-key');
    const attachmentShortcut = document.querySelector('.detail-toolbar-attachment .shortcut-key');

    expect(attachmentShortcut.classList.contains('is-available')).toBe(true);
    expect(tagShortcut.classList.contains('is-available')).toBe(true);
  });

  it('본문은 자동으로 높이를 늘리고 바깥 스크롤 영역을 사용한다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });

    const body = document.querySelector('.inline-body');
    const scroll = body.closest('.inline-editor-scroll');
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 520 });

    expect(scroll).not.toBe(body.parentElement);
    expect(scroll.querySelector('.inline-editor-fields')).toBeTruthy();

    await fireEvent.input(body, { target: { value: '긴 본문을 입력하는 중' } });

    expect(body.style.height).toBe('520px');
  });

  it('한글 조합 중에는 본문을 다시 제어하지 않고 조합 종료 때 한 번만 커밋한다', async () => {
    localStorage.clear();
    const onDraftChange = vi.fn();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999,
      onDraftChange
    });

    const body = document.querySelector('.inline-body');
    vi.useFakeTimers();
    try {
      await fireEvent.compositionStart(body);
      await fireEvent.input(body, { target: { value: 'ㅎ' }, isComposing: true });
      await fireEvent.input(body, { target: { value: '하' }, isComposing: true });

      expect(body.value).toBe('하');
      expect(onDraftChange).not.toHaveBeenCalled();
      expect(updateIssue).not.toHaveBeenCalled();

      await fireEvent.compositionEnd(body);
      expect(onDraftChange).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      expect(onDraftChange).toHaveBeenCalledTimes(1);
      expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ body: '하' }));

      // 일부 WebKit 버전은 compositionend 직후 최종 input을 한 번 더 보낸다.
      // 이미 커밋한 값을 다시 부모에 전달하거나 저장 예약하지 않아야 한다.
      await fireEvent.input(body, { target: { value: '하' }, isComposing: false });
      expect(onDraftChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('새 노트의 붙여넣기 본문은 번호 할당 전에도 즉시 부모에 전달한다', async () => {
    localStorage.clear();
    const onDraftChange = vi.fn();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: null,
      initialDraft: { id: 'paste-session', title: '', body: '', labels: [] },
      autoSaveSeconds: 9999,
      onDraftChange
    });

    const body = document.querySelector('.inline-body');
    await fireEvent.input(body, { target: { value: '붙여넣은 본문' } });

    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
      body: '붙여넣은 본문'
    }));
  });

  it('목록에 보이는 첫 두 줄이 그대로면 타이핑해도 목록 초안을 다시 알리지 않는다', async () => {
    localStorage.clear();
    const onDraftChange = vi.fn();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999,
      onDraftChange
    });

    const body = document.querySelector('.inline-body');
    vi.useFakeTimers();
    try {
      await fireEvent.input(body, { target: { value: '첫 줄\n둘째 줄\n셋째 줄' } });
      await vi.advanceTimersByTimeAsync(500);
      expect(onDraftChange).toHaveBeenCalledTimes(1);

      await fireEvent.input(body, { target: { value: '첫 줄\n둘째 줄\n바뀐 셋째 줄' } });
      await vi.advanceTimersByTimeAsync(500);
      expect(onDraftChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(issue, expect.any(Promise)));
    expect(issueLinkSpy).toHaveBeenCalledTimes(1);
  });

  it('삭제를 누르면 저장 중에도 즉시 이동 요청을 보내고, 전달한 Promise로 저장 완료를 보장한다', async () => {
    const onMove = vi.fn();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999,
      onMove
    });

    const bodyTextarea = document.querySelector('.inline-body');
    await fireEvent.input(bodyTextarea, { target: { value: '삭제 직전 변경한 본문' } });
    const deleteButton = [...document.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-keyshortcuts') === 'Delete');
    await fireEvent.click(deleteButton);

    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ number: 5 }), expect.any(Promise));
    const savePromise = onMove.mock.calls[0][1];

    await waitFor(() => expect(updateIssue).toHaveBeenCalledWith(
      't',
      'owner/repo',
      5,
      expect.objectContaining({ body: '삭제 직전 변경한 본문' }),
      expect.any(Object)
    ));
    await expect(savePromise).resolves.toBe(true);
  });

  it('E는 음성 녹음을 열고 X는 치환 패널을 연다', async () => {
    const onVoiceRecording = vi.fn();
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      onVoiceRecording
    });

    dispatchShortcut('e', 'KeyE');
    expect(onVoiceRecording).toHaveBeenCalledWith(baseIssue, expect.objectContaining({
      type: 'body'
    }));

    dispatchShortcut('x', 'KeyX');
    await waitFor(() => expect(document.querySelector('.replace-panel')).toBeTruthy());
  });
});

describe('NoteEditor 첨부 파일', () => {
  it('번호를 할당 중인 새 노트의 붙여넣기 파일은 교체 뒤 편집기로 넘긴다', async () => {
    let resolveAllocation;
    const onFileUploadRequested = vi.fn();
    const allocationPromise = new Promise((resolve) => { resolveAllocation = resolve; });
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: null,
      initialDraft: { id: 'new-paste', title: '', body: '', labels: [] },
      allocationPromise,
      onFileUploadRequested
    });

    const file = new File(['image'], 'clipboard.png', { type: 'image/png' });
    const body = document.querySelector('.inline-body');
    await fireEvent.paste(body, { clipboardData: { files: [file] } });

    expect(onFileUploadRequested).toHaveBeenCalledWith([file]);
    expect(uploadAttachment).not.toHaveBeenCalled();

    // 이 시점에 번호가 도착해도 파괴될 예정인 현재 인스턴스는 업로드하지 않는다.
    resolveAllocation({ number: 42, title: '', body: '', labels: [] });
    await Promise.resolve();
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it('댓글 첨부의 진행·완료 목록은 해당 댓글 아래에만 표시한다', async () => {
    let finishUpload;
    uploadAttachment.mockImplementationOnce(() => new Promise((resolve) => { finishUpload = resolve; }));
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });
    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());

    await fireEvent.click(document.querySelector('.note-comment-attachment'));
    const file = new File(['binary'], 'comment-progress.png', { type: 'image/png' });
    const change = fireEvent.change(document.querySelector('#comment-attachment-note'), { target: { files: [file] } });

    await waitFor(() => expect(document.querySelector('.note-comment-item .attachment-uploading')).toBeTruthy());
    expect(document.querySelector('.attachment-section .attachment-uploading')).toBeNull();

    finishUpload({
      name: file.name,
      type: file.type,
      path: '.issue-note-assets/issues/5/comments/1/uuid-comment-progress.png',
      sha: 'file-sha',
      size: file.size,
      url: 'https://github.com/file'
    });
    await change;

    await waitFor(() => expect(document.querySelector('.note-comment-item .attachment-name').textContent)
      .toBe('comment-progress.png'));
    expect(document.querySelector('.attachment-section')).toBeNull();
  });

  it('댓글 툴바에서 파일을 첨부하면 해당 댓글에 링크를 넣고 저장한다', async () => {
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue });
    await waitFor(() => expect(screen.getByText('octocat')).toBeTruthy());

    await fireEvent.click(document.querySelector('.note-comment-attachment'));
    const file = new File(['binary'], 'comment.png', { type: 'image/png' });
    await fireEvent.change(document.querySelector('#comment-attachment-note'), { target: { files: [file] } });

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith('t', 'owner/repo', 5, file, 1));
    await waitFor(() => expect(updateIssueComment).toHaveBeenCalledWith(
      't',
      'owner/repo',
      1,
      expect.stringContaining('.issue-note-assets/issues/5/comments/1/uuid-comment.png')
    ));

    const body = document.querySelector('.inline-body');
    await fireEvent.input(body, { target: { value: '노트 본문 수정' } });
    await fireEvent.blur(body);
    await waitFor(() => expect(updateIssue).toHaveBeenCalled());
    expect(updateIssue.mock.calls.at(-1)[3].body).not.toContain('uuid-comment.png');
  });

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
  it('새 태그는 먼저 만들고 목록을 갱신한 뒤 즉시 노트에 적용한다', async () => {
    const onLabelsAvailable = vi.fn();
    createLabel.mockResolvedValueOnce({ name: 'idea', color: 'abcdef' });
    render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      availableLabels: [{ name: 'work' }],
      onLabelsAvailable,
      ignoreRecoveredDraft: true,
      autoSaveSeconds: 9999
    });

    await fireEvent.click(document.querySelector('.detail-toolbar-actions-desktop .tag-picker > button'));
    await fireEvent.input(screen.getByRole('textbox', { name: 'Tag name: classification description' }), { target: { value: 'idea' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create #idea' }));

    await waitFor(() => expect(createLabel).toHaveBeenCalledWith('t', 'owner/repo', 'idea', { description: '' }));
    await waitFor(() => expect(onLabelsAvailable).toHaveBeenCalledWith([{ name: 'idea', color: 'abcdef' }]));
    await waitFor(() => expect(document.querySelector('.editor-tag-link')?.textContent).toBe('#idea'));
    await waitFor(() => expect(updateIssue).toHaveBeenCalled());
    expect(updateIssue.mock.calls.at(-1)[3].labels).toContain('idea');
  });

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

describe('NoteEditor 노트 잠금', () => {
  // 편집기를 닫을 때 남긴 로컬 초안이 다음 테스트의 같은 노트에 복구되지 않게 한다.
  beforeEach(() => localStorage.clear());

  const lockedIssue = { ...baseIssue, title: '🔒 비밀 노트', body: 'enc|123456|5|비밀 본문', comments: 0 };

  function renderWithLockSession({ lockPin = '', ...editorProps }) {
    const onSetLockSession = vi.fn();
    const view = render(LockSessionHost, {
      lockPin,
      onSetLockSession,
      editorProps: {
        token: 't',
        repo: 'owner/repo',
        titleMode: 'separate',
        autoSaveSeconds: 9999,
        ...editorProps
      }
    });
    return { ...view, onSetLockSession };
  }

  function menuItem(label) {
    return [...document.querySelectorAll('.dropdown-item')]
      .find((item) => item.textContent.trim().startsWith(label));
  }

  async function typePin(value) {
    const input = document.querySelector('.note-lock-panel input[type="text"]');
    await fireEvent.input(input, { target: { value } });
  }

  it('6자리 숫자로 잠그면 제목에 자물쇠를 붙이고 본문을 암호화해 저장한다', async () => {
    const { onSetLockSession } = renderWithLockSession({ issue: baseIssue });

    await fireEvent.click(menuItem('잠금'));
    const panel = await waitFor(() => {
      const element = document.querySelector('.note-lock-panel');
      expect(element).toBeTruthy();
      return element;
    });

    await typePin('12345');
    await fireEvent.submit(panel);
    expect(panel.querySelector('.note-lock-error').textContent).toBe('6자리 숫자를 입력해 주세요.');
    expect(encryptLockedBody).not.toHaveBeenCalled();

    await typePin('12a34-56');
    expect(panel.querySelector('input[type="text"]').value).toBe('123456');
    await fireEvent.click(within(panel).getByRole('button', { name: '잠그기' }));

    await waitFor(() => expect(updateIssue).toHaveBeenCalledWith(
      't',
      'owner/repo',
      5,
      expect.objectContaining({ title: '🔒 노트 제목', body: 'enc|123456|5|노트 본문' }),
      expect.any(Object)
    ));
    expect(onSetLockSession).toHaveBeenCalledWith('123456');
    expect(document.querySelector('.note-lock-panel')).toBeNull();
  });

  it('잠금 패널을 취소하면 아무것도 저장하지 않는다', async () => {
    renderWithLockSession({ issue: baseIssue });

    await fireEvent.click(menuItem('잠금'));
    const panel = await waitFor(() => {
      const element = document.querySelector('.note-lock-panel');
      expect(element).toBeTruthy();
      return element;
    });
    await fireEvent.click(within(panel).getByRole('button', { name: '취소' }));

    expect(document.querySelector('.note-lock-panel')).toBeNull();
    expect(encryptLockedBody).not.toHaveBeenCalled();
  });

  it('잠긴 노트는 틀린 숫자면 오류를 보여주고, 맞는 숫자를 6자리 채우는 즉시 연다', async () => {
    const { onSetLockSession } = renderWithLockSession({ issue: lockedIssue });

    const bodyTextarea = document.querySelector('.inline-body');
    await waitFor(() => expect(document.querySelector('.note-lock-panel')).toBeTruthy());
    expect(bodyTextarea.readOnly).toBe(true);
    expect(bodyTextarea.value).toBe(lockedIssue.body);

    await typePin('000000');
    await waitFor(() => expect(document.querySelector('.note-lock-error')?.textContent)
      .toBe('6자리 숫자가 맞지 않습니다.'));
    expect(document.querySelector('.note-lock-panel input[type="text"]').value).toBe('');

    await typePin('123456');

    await waitFor(() => expect(document.querySelector('.note-lock-panel')).toBeNull());
    expect(bodyTextarea.value).toBe('비밀 본문');
    expect(bodyTextarea.readOnly).toBe(false);
    expect(document.querySelector('.inline-title').value).toBe('비밀 노트');
    expect(onSetLockSession).toHaveBeenCalledWith('123456');
  });

  it('잠금 세션의 숫자가 있으면 잠긴 노트를 자동으로 열고, 틀리면 직접 입력을 받는다', async () => {
    renderWithLockSession({ issue: lockedIssue, lockPin: '123456' });

    await waitFor(() => expect(document.querySelector('.note-lock-panel')?.textContent).toContain('암호 재사용중'));
    await waitFor(() => expect(document.querySelector('.inline-body').value).toBe('비밀 본문'), { timeout: 3000 });
    expect(document.querySelector('.note-lock-panel')).toBeNull();

    cleanup();
    renderWithLockSession({ issue: lockedIssue, lockPin: '999999' });

    await waitFor(() => expect(document.querySelector('.note-lock-error')?.textContent)
      .toBe('6자리 숫자가 맞지 않습니다.'), { timeout: 3000 });
    expect(document.querySelector('.note-lock-panel input[type="text"]')).toBeTruthy();
    // 같은 세션 숫자로 계속 재시도하느라 입력칸을 가리지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(document.querySelector('.note-lock-panel').textContent).not.toContain('암호 재사용중');
    expect(decryptLockedBody).toHaveBeenCalledTimes(2);
  });

  it('잠금 세션이 끝나면 편집 중인 내용을 암호화해 저장한 뒤 다시 잠근다', async () => {
    const { rerender } = renderWithLockSession({ issue: lockedIssue, lockPin: '123456' });
    const bodyTextarea = document.querySelector('.inline-body');
    await waitFor(() => expect(bodyTextarea.value).toBe('비밀 본문'), { timeout: 3000 });

    await fireEvent.input(bodyTextarea, { target: { value: '만료 직전 수정' } });
    await rerender({ lockPin: '' });

    await waitFor(() => expect(updateIssue).toHaveBeenCalledWith(
      't',
      'owner/repo',
      5,
      expect.objectContaining({ title: '🔒 비밀 노트', body: 'enc|123456|5|만료 직전 수정' }),
      expect.any(Object)
    ));
    await waitFor(() => expect(document.querySelector('.note-lock-error')?.textContent)
      .toContain('잠금 시간이 만료되었습니다'));
    expect(bodyTextarea.readOnly).toBe(true);
    expect(bodyTextarea.value).toBe('enc|123456|5|만료 직전 수정');
  });

  it('열린 잠금 노트에서 잠금을 풀면 평문 본문과 자물쇠 없는 제목으로 저장한다', async () => {
    renderWithLockSession({ issue: lockedIssue, lockPin: '123456' });
    await waitFor(() => expect(document.querySelector('.inline-body').value).toBe('비밀 본문'), { timeout: 3000 });

    await fireEvent.click(menuItem('잠금 풀기'));

    await waitFor(() => expect(updateIssue).toHaveBeenCalledWith(
      't',
      'owner/repo',
      5,
      expect.objectContaining({ title: '비밀 노트', body: '비밀 본문' }),
      expect.any(Object)
    ));
  });
});

describe('NoteEditor 원격 변경 반영', () => {
  // 편집기를 닫을 때 남긴 로컬 초안이 다음 테스트의 같은 노트에 복구되지 않게 한다.
  beforeEach(() => localStorage.clear());

  it('백그라운드 새로고침에서 원격 내용이 바뀌었으면 편집기에 반영한다', async () => {
    const onRefreshed = vi.fn();
    const onRefreshStateChange = vi.fn();
    const refreshed = { ...baseIssue, body: '다른 디바이스에서 고친 본문', labels: [{ name: 'work' }] };
    const { rerender } = render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999,
      onRefreshed,
      onRefreshStateChange
    });
    getIssue.mockResolvedValueOnce(refreshed);

    await rerender({ refreshRequest: 1 });

    await waitFor(() => expect(onRefreshed).toHaveBeenCalledWith(refreshed));
    expect(document.querySelector('.inline-body').value).toBe('다른 디바이스에서 고친 본문');
    expect(onRefreshStateChange.mock.calls.map(([state]) => state)).toEqual([true, false]);
  });

  it('백그라운드 새로고침에서 원격 내용이 같으면 편집기를 다시 그리지 않는다', async () => {
    const onRefreshed = vi.fn();
    const onRefreshStateChange = vi.fn();
    const { rerender } = render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999,
      onRefreshed,
      onRefreshStateChange
    });
    getIssue.mockResolvedValueOnce({ ...baseIssue, updated_at: '2026-09-02T00:00:00Z' });

    await rerender({ refreshRequest: 1 });

    await waitFor(() => expect(onRefreshStateChange).toHaveBeenLastCalledWith(false));
    expect(getIssue).toHaveBeenCalledTimes(1);
    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it('편집 중인 변경이 있으면 백그라운드 새로고침을 건너뛴다', async () => {
    const onRefreshStateChange = vi.fn();
    const { rerender } = render(NoteEditor, {
      token: 't',
      repo: 'owner/repo',
      issue: baseIssue,
      autoSaveSeconds: 9999,
      onRefreshStateChange
    });
    await fireEvent.input(document.querySelector('.inline-body'), { target: { value: '저장 전 수정' } });

    await rerender({ refreshRequest: 1 });

    expect(onRefreshStateChange).toHaveBeenCalledWith(false);
    expect(getIssue).not.toHaveBeenCalled();
    expect(document.querySelector('.inline-body').value).toBe('저장 전 수정');
  });

  it('저장 응답에서야 닫힌 걸 알았을 때 아니오를 고르면 방금 쓴 내용을 되돌린다', async () => {
    const onRefreshed = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => false));
    updateIssue
      .mockResolvedValueOnce({ ...baseIssue, body: '늦게 닫힌 노트의 수정', state: 'closed' })
      .mockResolvedValueOnce({ ...baseIssue, state: 'closed' });
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue, titleMode: 'separate', autoSaveSeconds: 9999, onRefreshed });

    const bodyTextarea = document.querySelector('.inline-body');
    await fireEvent.input(bodyTextarea, { target: { value: '늦게 닫힌 노트의 수정' } });
    await fireEvent.blur(bodyTextarea);

    await waitFor(() => expect(updateIssue).toHaveBeenCalledTimes(2));
    expect(updateIssue.mock.calls[1][3]).toEqual(expect.objectContaining({ body: '노트 본문' }));
    await waitFor(() => expect(bodyTextarea.value).toBe('노트 본문'));
    expect(onRefreshed).toHaveBeenCalledWith(expect.objectContaining({ state: 'closed' }));
  });

  it('저장 응답에서야 닫힌 걸 알았을 때 예를 고르면 다시 열면서 저장한다', async () => {
    const onSaved = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => true));
    updateIssue.mockResolvedValueOnce({ ...baseIssue, body: '다시 열 노트의 수정', state: 'closed' });
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue, titleMode: 'separate', autoSaveSeconds: 9999, onSaved });

    const bodyTextarea = document.querySelector('.inline-body');
    await fireEvent.input(bodyTextarea, { target: { value: '다시 열 노트의 수정' } });
    await fireEvent.blur(bodyTextarea);

    await waitFor(() => expect(updateIssue).toHaveBeenCalledTimes(2));
    expect(updateIssue.mock.calls[1][3]).toEqual(expect.objectContaining({
      body: '다시 열 노트의 수정',
      state: 'open'
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ state: 'open' }), null));
    expect(bodyTextarea.value).toBe('다시 열 노트의 수정');
  });
});

describe('NoteEditor 댓글 첨부 삭제', () => {
  beforeEach(() => localStorage.clear());

  const commentAttachment = {
    name: 'comment.png',
    type: 'image/png',
    path: '.issue-note-assets/issues/5/comments/1/comment.png',
    sha: 'comment-sha',
    size: 10
  };
  const commentLink = composeAttachmentLink('owner/repo', commentAttachment);

  async function renderCommentWithAttachment() {
    listIssueComments.mockResolvedValueOnce([{
      id: 1,
      // 댓글 첨부는 업로드할 때 본문이 아니라 자동 관리 블록에 링크가 들어간다.
      body: withManagedAttachmentBlock('댓글 내용', [commentLink]),
      author: 'octocat',
      avatarUrl: '',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      url: ''
    }]);
    listIssueCommentAttachmentFiles.mockResolvedValueOnce([
      { name: commentAttachment.name, path: commentAttachment.path, sha: commentAttachment.sha, size: commentAttachment.size, url: '' }
    ]);
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue: baseIssue, autoSaveSeconds: 9999 });
    await waitFor(() => expect(document.querySelector('.note-comment-item .attachment-item')).toBeTruthy());
  }

  it('5초 뒤 저장돼 있던 댓글의 관리 링크를 빼 저장한 다음 파일을 지운다', async () => {
    await renderCommentWithAttachment();

    vi.useFakeTimers();
    try {
      await fireEvent.click(document.querySelector('.note-comment-item .attachment-delete'));
      expect(deleteAttachment).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);

      await waitFor(() => expect(deleteAttachment).toHaveBeenCalledWith(
        't', 'owner/repo', expect.objectContaining({ path: commentAttachment.path })
      ));
      const savedBody = updateIssueComment.mock.calls.at(-1)[3];
      expect(savedBody).toBe('댓글 내용');
      expect(updateIssueComment.mock.invocationCallOrder.at(-1))
        .toBeLessThan(deleteAttachment.mock.invocationCallOrder[0]);
      await waitFor(() => expect(document.querySelector('.note-comment-item .attachment-item')).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it('5초 안에 취소하면 댓글과 파일을 그대로 둔다', async () => {
    await renderCommentWithAttachment();

    vi.useFakeTimers();
    try {
      await fireEvent.click(document.querySelector('.note-comment-item .attachment-delete'));
      await fireEvent.click(within(document.querySelector('.note-comment-item')).getByRole('button', { name: 'Cancel' }));
      await vi.advanceTimersByTimeAsync(5000);
    } finally {
      vi.useRealTimers();
    }

    expect(updateIssueComment).not.toHaveBeenCalled();
    expect(deleteAttachment).not.toHaveBeenCalled();
    expect(document.querySelector('.note-comment-item .attachment-pending-delete')).toBeNull();
  });

  it('댓글 저장이 실패하면 링크가 남은 파일을 지우지 않는다', async () => {
    await renderCommentWithAttachment();
    updateIssueComment.mockRejectedValueOnce(Object.assign(new Error('Server Error'), { status: 500 }));

    vi.useFakeTimers();
    try {
      await fireEvent.click(document.querySelector('.note-comment-item .attachment-delete'));
      await vi.advanceTimersByTimeAsync(5000);
      await waitFor(() => expect(updateIssueComment).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }

    expect(deleteAttachment).not.toHaveBeenCalled();
    expect(document.querySelector('.note-comment-item .attachment-item')).toBeTruthy();
  });

  it('파일 삭제가 실패하면 오류를 보여주고 첨부를 목록에 남긴다', async () => {
    await renderCommentWithAttachment();
    deleteAttachment.mockRejectedValueOnce(new Error('첨부를 지우지 못했습니다'));

    vi.useFakeTimers();
    try {
      await fireEvent.click(document.querySelector('.note-comment-item .attachment-delete'));
      await vi.advanceTimersByTimeAsync(5000);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => expect(screen.getByText('첨부를 지우지 못했습니다')).toBeTruthy());
    expect(document.querySelector('.note-comment-item .attachment-item')).toBeTruthy();
  });
});

describe('NoteEditor 첨부 뷰어', () => {
  beforeEach(() => localStorage.clear());

  const first = { name: 'first.png', type: 'image/png', path: '.issue-note-assets/issues/5/first.png', sha: 'sha-first', size: 10 };
  const second = { name: 'second.png', type: 'image/png', path: '.issue-note-assets/issues/5/second.png', sha: 'sha-second', size: 20 };

  async function renderWithAttachments() {
    listIssueAttachmentFiles.mockResolvedValueOnce([first, second].map((item) => ({
      name: item.name, path: item.path, sha: item.sha, size: item.size, url: ''
    })));
    downloadAttachment.mockResolvedValue(new Blob(['image']));
    const issue = {
      ...baseIssue,
      body: `노트 본문\n\n${composeAttachmentLink('owner/repo', first)}\n\n${composeAttachmentLink('owner/repo', second)}`
    };
    render(NoteEditor, { token: 't', repo: 'owner/repo', issue, autoSaveSeconds: 9999 });
    await waitFor(() => expect(document.querySelectorAll('.attachment-section .attachment-open')).toHaveLength(2));
  }

  function viewerFileName() {
    return document.querySelector('.attachment-viewer .viewer-file-name')?.textContent;
  }

  it('첨부를 누르면 뷰어로 열고 화살표 키로 순환 이동하며 Escape로 닫는다', async () => {
    await renderWithAttachments();

    await fireEvent.click(document.querySelectorAll('.attachment-section .attachment-open')[0]);
    const viewer = document.querySelector('.attachment-viewer');
    expect(viewerFileName()).toBe('first.png');
    expect(viewer.textContent).toContain('1 / 2');

    await fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    expect(viewerFileName()).toBe('second.png');
    await fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    expect(viewerFileName()).toBe('first.png');
    await fireEvent.keyDown(viewer, { key: 'ArrowLeft' });
    expect(viewerFileName()).toBe('second.png');
    await waitFor(() => expect(downloadAttachment).toHaveBeenCalledWith(
      't', 'owner/repo', expect.objectContaining({ path: second.path })
    ));

    await fireEvent.keyDown(viewer, { key: 'Escape' });
    expect(document.querySelector('.attachment-viewer')).toBeNull();
  });

  it('뷰어의 Markdown 복사는 편집기용 첨부 링크를 클립보드에 넣고, 실패하면 오류를 보여준다', async () => {
    const writeText = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await renderWithAttachments();
    await fireEvent.click(document.querySelectorAll('.attachment-section .attachment-open')[1]);
    const copyButton = within(document.querySelector('.attachment-viewer')).getByRole('button', { name: /Markdown 복사/ });

    await fireEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledWith(composeAttachmentLink('owner/repo', second));
    expect(screen.queryByText('Could not copy to the clipboard.')).toBeNull();

    await fireEvent.click(copyButton);
    await waitFor(() => expect(screen.getByText('Could not copy to the clipboard.')).toBeTruthy());
  });
});
