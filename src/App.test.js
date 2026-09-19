import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// GitHub를 메모리 안의 가짜 저장소로 대신한다. App은 이 모듈만 통해 GitHub와 통신하므로,
// 여기서 기록한 호출과 데이터로 화면 흐름 전체를 검증할 수 있다.
const github = vi.hoisted(() => {
  const state = { issues: [], labels: [], nextNumber: 100, nextId: 1000, calls: [] };

  function label(name, extra = {}) {
    return { id: `label-${name}`, name, description: '', color: 'cccccc', ...extra };
  }

  function issue(number, fields = {}) {
    return {
      id: number * 10,
      number,
      title: `노트 ${number}`,
      body: `노트 ${number} 본문`,
      labels: [],
      state: 'open',
      comments: 0,
      updated_at: `2026-09-${String(10 + (number % 18)).padStart(2, '0')}T00:00:00Z`,
      created_at: '2026-09-01T00:00:00Z',
      closed_at: null,
      ...fields
    };
  }

  function record(name, args) {
    state.calls.push({ name, args });
  }

  function findIssue(number) {
    const found = state.issues.find((item) => item.number === Number(number));
    if (!found) throw Object.assign(new Error('Not Found'), { status: 404 });
    return found;
  }

  function clone(value) {
    return structuredClone(value);
  }

  function matchesLabel(item, name) {
    return !name || item.labels.some((entry) => entry.name.toLowerCase() === name.toLowerCase());
  }

  function sorted(items) {
    return [...items].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  function toLabels(names) {
    return names.map((name) => state.labels.find((entry) => entry.name.toLowerCase() === String(name).toLowerCase()) || label(name));
  }

  const api = {
    verifyConnection: async (token, repo) => {
      record('verifyConnection', [token, repo]);
      if (token === 'bad-token') throw Object.assign(new Error('Bad credentials'), { status: 401 });
      return { user: { login: 'octocat' }, repository: { full_name: repo }, repo };
    },
    listIssuesPage: async (token, repo, issueState = 'open', labelName = '', page = 1, now, pageSize = 30) => {
      record('listIssuesPage', [token, repo, issueState, labelName, page, pageSize]);
      const items = sorted(state.issues.filter((item) => item.state === issueState && matchesLabel(item, labelName)));
      const start = (page - 1) * pageSize;
      return {
        items: clone(items.slice(start, start + pageSize)),
        hasMore: start + pageSize < items.length,
        totalCount: page === 1 ? items.length : null
      };
    },
    searchIssuesPage: async (token, repo, issueState, term, labelName = '') => {
      record('searchIssuesPage', [token, repo, issueState, term, labelName]);
      const needle = term.trim().toLowerCase();
      const items = sorted(state.issues.filter((item) => item.state === issueState
        && matchesLabel(item, labelName)
        && `${item.title}\n${item.body}`.toLowerCase().includes(needle)));
      return { items: clone(items), hasMore: false, totalCount: items.length };
    },
    listExpiredClosedIssues: async () => [],
    purgeIssueAttachments: async () => null,
    listLabels: async () => clone(state.labels),
    getIssue: async (token, repo, number) => clone(findIssue(number)),
    createIssue: async (token, repo, note) => {
      record('createIssue', [token, repo, note]);
      const created = issue(state.nextNumber++, {
        id: state.nextId++,
        title: note.title,
        body: note.body,
        labels: toLabels(note.labels || []),
        updated_at: '2026-09-30T00:00:00Z'
      });
      state.issues.push(created);
      return clone(created);
    },
    updateIssue: async (token, repo, number, note) => {
      record('updateIssue', [token, repo, number, note]);
      const target = findIssue(number);
      Object.assign(target, {
        title: note.title ?? target.title,
        body: note.body ?? target.body,
        labels: note.labels ? toLabels(note.labels) : target.labels,
        state: note.state || target.state
      });
      return clone(target);
    },
    setIssueState: async (token, repo, number, nextState) => {
      record('setIssueState', [token, repo, number, nextState]);
      const target = findIssue(number);
      target.state = nextState;
      return clone(target);
    },
    setIssueLabels: async (token, repo, number, names) => {
      record('setIssueLabels', [token, repo, number, names]);
      const target = findIssue(number);
      target.labels = toLabels(names);
      return clone(target);
    },
    addIssueLabel: async (token, repo, number, name) => {
      record('addIssueLabel', [token, repo, number, name]);
      const target = findIssue(number);
      if (!matchesLabel(target, name)) target.labels = [...target.labels, ...toLabels([name])];
      return clone(target.labels);
    },
    removeIssueLabel: async (token, repo, number, name) => {
      record('removeIssueLabel', [token, repo, number, name]);
      const target = findIssue(number);
      target.labels = target.labels.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase());
      return clone(target.labels);
    },
    createLabel: async (token, repo, name, options = {}) => {
      record('createLabel', [token, repo, name, options]);
      const created = label(name, { description: options.description || '' });
      state.labels.push(created);
      return clone(created);
    },
    renameLabel: async (token, repo, currentName, nextName, description) => {
      record('renameLabel', [token, repo, currentName, nextName, description]);
      const target = state.labels.find((entry) => entry.name === currentName);
      Object.assign(target, { name: nextName, description });
      for (const item of state.issues) {
        item.labels = item.labels.map((entry) => entry.name === currentName ? { ...entry, name: nextName } : entry);
      }
      return clone(target);
    },
    removeLabel: async (token, repo, name) => {
      record('removeLabel', [token, repo, name]);
      state.labels = state.labels.filter((entry) => entry.name !== name);
      return null;
    },
    loadVoiceTranscriptionHints: async () => '',
    saveVoiceTranscriptionHints: async (token, repo, hints) => hints,
    listIssueComments: async () => [],
    listIssueAttachmentFiles: async () => [],
    listIssueCommentAttachmentFiles: async () => [],
    listAllIssueAttachmentFiles: async () => [],
    uploadAttachment: async (token, repo, number, file) => ({ name: file.name, path: `.issue-note-assets/issues/${number}/${file.name}`, type: file.type }),
    downloadAttachment: async () => new Blob(['file']),
    deleteAttachment: async () => null,
    createIssueComment: async (token, repo, number, body) => ({ id: state.nextId++, body, author: 'octocat', createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z' }),
    updateIssueComment: async (token, repo, id, body) => ({ id, body }),
    deleteIssueComment: async () => null
  };

  return { state, api, issue, label };
});

vi.mock('./lib/github.js', () => {
  const mocked = {};
  for (const [name, implementation] of Object.entries(github.api)) mocked[name] = vi.fn(implementation);
  return mocked;
});

// 녹음기는 마이크가 필요하므로 src/lib/__mocks__/VoiceRecorder.svelte 대역을 쓴다.
vi.mock('./lib/VoiceRecorder.svelte');

import App from './App.svelte';
import * as githubModule from './lib/github.js';
import { setAppLocale } from './lib/i18n.js';

const SETTINGS_KEY = 'issue-note.settings.v1';

function saveWorkspaces(workspaces = [{ id: 'ws-1', repo: 'octo/notes', token: 'ghp_test', rememberToken: true }], preferences = {}) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    workspaces,
    activeWorkspaceId: workspaces[0]?.id || '',
    preferences: { language: 'en', ...preferences }
  }));
}

function seedRepository() {
  github.state.labels = [github.label('work'), github.label('home'), github.label('ginote:pin')];
  github.state.issues = [
    // updated_at 내림차순이 목록 순서다: 장보기 → 회의록.
    github.issue(1, { title: '장보기', body: '우유 계란', labels: [github.label('home')], updated_at: '2026-09-20T00:00:00Z' }),
    github.issue(2, { title: '회의록', body: '분기 계획', labels: [github.label('work')], updated_at: '2026-09-19T00:00:00Z' }),
    github.issue(3, { title: '고정 메모', body: '늘 보는 내용', labels: [github.label('ginote:pin')], updated_at: '2026-09-18T00:00:00Z' }),
    github.issue(4, { title: '지난 메모', body: '휴지통', state: 'closed', closed_at: '2026-09-15T00:00:00Z' })
  ];
}

function callsTo(name) {
  return github.state.calls.filter((call) => call.name === name).map((call) => call.args);
}

function rowTitles(selector = '.note-list-row') {
  return [...document.querySelectorAll(`${selector} .note-row-title`)].map((node) => node.textContent.trim());
}

// 고정 노트 요청(ginote:pin)을 뺀 일반 목록 요청만 모은다.
function listCalls() {
  return callsTo('listIssuesPage').filter((args) => args[3] !== 'ginote:pin');
}

async function renderReadyApp() {
  const result = render(App);
  await waitFor(() => expect(rowTitles().length).toBeGreaterThan(0));
  return result;
}

function key(keyValue, options = {}) {
  return fireEvent.keyDown(window, { key: keyValue, ...options });
}

beforeEach(() => {
  setAppLocale('en');
  localStorage.clear();
  history.replaceState(null, '', '/');
  github.state.calls = [];
  github.state.nextNumber = 100;
  github.state.nextId = 1000;
  seedRepository();
  vi.stubGlobal('matchMedia', vi.fn((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })));
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('alert', vi.fn());
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  // jsdom에는 레이아웃이 없어 모든 영역이 0으로 잡힌다. 목록 영역 안에 행이 보이는 것으로 둔다.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    return this.classList.contains('note-list-scroll')
      ? { top: 0, bottom: 600, left: 0, right: 300, width: 300, height: 600 }
      : { top: 10, bottom: 40, left: 0, right: 300, width: 300, height: 30 };
  });
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('App 시작', () => {
  it('저장된 저장소가 없으면 설정 마법사를 보여준다', async () => {
    render(App);
    expect(await screen.findByText('Set up Ginote')).toBeTruthy();
    expect(githubModule.verifyConnection).not.toHaveBeenCalled();
  });

  it('저장된 저장소로 자동 연결해 고정 노트를 맨 위에 두고 노트 목록을 보여준다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    expect(callsTo('verifyConnection')[0]).toEqual(['ghp_test', 'octo/notes']);
    expect(rowTitles()).toEqual(['고정 메모', '장보기', '회의록']);
    expect(document.querySelector('.note-list-pinned .note-row-title').textContent).toContain('고정 메모');
    // 목록 요청과 고정 노트 요청을 함께 보낸다.
    expect(callsTo('listIssuesPage').map((args) => args[3])).toEqual(expect.arrayContaining(['', 'ginote:pin']));
  });

  it('인증에 실패하면 설정 화면으로 돌아가 이유를 알린다', async () => {
    saveWorkspaces([{ id: 'ws-1', repo: 'octo/notes', token: 'bad-token', rememberToken: true }]);
    render(App);

    expect(await screen.findByText('Set up Ginote')).toBeTruthy();
  });
});

describe('노트 목록 탐색', () => {
  it('노트를 누르면 주소가 바뀌고 편집기가 열린다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    await fireEvent.click(screen.getByRole('button', { name: 'Open note 회의록' }));

    await waitFor(() => expect(window.location.hash).toBe('#!/note.2'));
    await waitFor(() => expect(document.querySelector('.note-detail-layer.active .inline-body')?.value).toContain('분기 계획'));
    expect(document.querySelector('.note-list-row.active .note-row-title').textContent).toContain('회의록');
  });

  it('검색어를 제출하면 검색 API로 목록을 바꾼다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    const search = screen.getByRole('combobox');
    await fireEvent.input(search, { target: { value: '계란' } });
    await fireEvent.submit(search.closest('form'));

    // 고정 노트는 검색 중에도 맨 위에 남는다.
    await waitFor(() => expect(rowTitles()).toEqual(['고정 메모', '장보기']));
    expect(callsTo('searchIssuesPage').at(-1).slice(2, 4)).toEqual(['open', '계란']);
  });

  it('#태그로 검색하면 태그 경로로 이동해 해당 태그 목록을 불러온다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    const search = screen.getByRole('combobox');
    await fireEvent.input(search, { target: { value: '#WORK' } });
    await fireEvent.submit(search.closest('form'));

    await waitFor(() => expect(window.location.hash).toBe('#!/tag.work'));
    await waitFor(() => expect(rowTitles()).toEqual(['고정 메모', '회의록']));
    expect(callsTo('listIssuesPage').some((args) => args[3] === 'work')).toBe(true);
    expect(search.value).toBe('#work');
  });

  it('검색창에서 태그 제안을 키보드로 골라 적용한다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    const search = screen.getByRole('combobox');
    await fireEvent.focus(search);
    await fireEvent.input(search, { target: { value: 'ho' } });
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['#home']);

    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'Enter' });

    await waitFor(() => expect(window.location.hash).toBe('#!/tag.home'));
  });

  it('휴지통 탭으로 바꾸면 닫힌 노트를 불러온다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    await fireEvent.click(screen.getByRole('button', { name: /Trash/ }));

    await waitFor(() => expect(rowTitles()).toEqual(['지난 메모']));
    expect(callsTo('listIssuesPage').some((args) => args[2] === 'closed')).toBe(true);
  });

  it('노트가 한 페이지를 넘으면 더 불러오기로 다음 페이지를 이어 붙인다', async () => {
    github.state.issues = Array.from({ length: 12 }, (_, index) => github.issue(index + 1));
    saveWorkspaces(undefined, { issuePageSize: 10 });
    await renderReadyApp();
    expect(rowTitles()).toHaveLength(10);

    await fireEvent.click(screen.getByRole('button', { name: /Load more/ }));

    await waitFor(() => expect(rowTitles()).toHaveLength(12));
    expect(listCalls().at(-1)[4]).toBe(2);
  });
});

describe('키보드 조작', () => {
  it('화살표로 목록을 이동하고 Enter로 노트를 연다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    await key('ArrowDown');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Open note 고정 메모');
    await key('ArrowDown');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Open note 장보기');

    await key('Enter');
    await waitFor(() => expect(window.location.hash).toBe('#!/note.1'));
  });

  it('N으로 새 노트를 만들고 번호를 미리 받아 둔다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    await key('n');

    await waitFor(() => expect(callsTo('createIssue')).toHaveLength(1));
    await waitFor(() => expect(window.location.hash).toBe('#!/note.100'));
  });

  it('Delete는 3초 유예 뒤 휴지통으로 옮기고, 그 전에 Esc로 취소할 수 있다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    await key('ArrowDown');
    await key('ArrowDown');
    document.activeElement.blur();
    await key('Delete');
    expect(document.querySelector('.note-list-row.pending-deletion .note-row-title').textContent).toContain('장보기');

    await key('Escape');
    expect(document.querySelector('.note-list-row.pending-deletion')).toBeNull();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await key('Delete');
    await vi.advanceTimersByTimeAsync(3000);
    vi.useRealTimers();

    await waitFor(() => expect(rowTitles()).toEqual(['고정 메모', '회의록']));
    expect(callsTo('setIssueState')).toEqual([['ghp_test', 'octo/notes', 1, 'closed']]);
  });

  it('Space와 Shift+화살표로 여러 노트를 골라 선택 도구를 연다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    await key('ArrowDown');
    await key(' ');
    await key('ArrowDown', { shiftKey: true });

    const checked = [...document.querySelectorAll('.note-list-row.selected .note-row-title')].map((node) => node.textContent.trim());
    expect(checked).toEqual(['고정 메모', '장보기']);
    expect(screen.getByRole('button', { name: /Merge/ }).disabled).toBe(false);

    await key('Escape');
    await key('Escape');
    expect(document.querySelectorAll('.note-list-row.selected')).toHaveLength(0);
  });

  it('숫자 키로 등록된 순서의 저장소로 전환한다', async () => {
    saveWorkspaces([
      { id: 'ws-1', repo: 'octo/notes', token: 'ghp_test', rememberToken: true },
      { id: 'ws-2', repo: 'octo/work', token: 'ghp_work', rememberToken: true }
    ]);
    await renderReadyApp();

    await key('2');

    await waitFor(() => expect(callsTo('verifyConnection').at(-1)).toEqual(['ghp_work', 'octo/work']));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)).activeWorkspaceId).toBe('ws-2'));
  });
});

describe('여러 노트 선택 작업', () => {
  it('선택한 노트에 태그를 붙인다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    await key('ArrowDown');
    await key('ArrowDown');
    await key(' ');
    await key('ArrowDown', { shiftKey: true });
    await fireEvent.click(screen.getByRole('button', { name: /^\s*Tags\s*$/ }));

    const tagButton = await screen.findByRole('button', { name: /#work/ });
    await fireEvent.click(tagButton);

    await waitFor(() => expect(callsTo('setIssueLabels')).toHaveLength(1));
    expect(callsTo('setIssueLabels')[0].slice(2)).toEqual([1, ['home', 'work']]);
  });

  it('선택한 노트를 병합하면 새 노트를 만들고 원본을 닫는다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    await key('ArrowDown');
    await key('ArrowDown');
    await key(' ');
    await key('ArrowDown', { shiftKey: true });
    await fireEvent.click(screen.getByRole('button', { name: /Merge/ }));

    await waitFor(() => expect(callsTo('setIssueState')).toHaveLength(2));
    expect(callsTo('createIssue')).toHaveLength(1);
    expect(callsTo('setIssueState').map((args) => args.slice(2))).toEqual([[1, 'closed'], [2, 'closed']]);
    await waitFor(() => expect(window.location.hash).toBe('#!/note.100'));
  });
});

describe('환경설정과 안내', () => {
  it('환경설정에서 바꾼 값은 닫을 때 저장한다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    await fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    await waitFor(() => expect(window.location.hash).toBe('#!/settings'));
    const pageSize = document.getElementById('issue-page-size');
    await fireEvent.input(pageSize, { target: { value: '50' } });
    await fireEvent.change(pageSize);

    await fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));

    await waitFor(() => expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)).preferences.issuePageSize).toBe(50));
    await waitFor(() => expect(listCalls().at(-1)[5]).toBe(50));
  });

  it('음성 API 키가 없으면 녹음 대신 환경설정의 음성 항목으로 안내한다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    await fireEvent.click(screen.getByRole('button', { name: '음성 녹음' }));

    expect(alert).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(window.location.hash).toBe('#!/settings'));
    await waitFor(() => expect(document.activeElement.id).toBe('voice-api-key'));
  });

  it('안내 링크는 도움말 레이어를 열고 닫는다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    await fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    await waitFor(() => expect(window.location.hash).toBe('#!/help.keyboard'));
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Keyboard shortcuts' })).toBeNull());
    expect(window.location.hash).not.toContain('help');
  });
});

function noteLayer() {
  return document.querySelector('.note-detail-layer.active');
}

async function openNote(title) {
  await fireEvent.click(screen.getByRole('button', { name: `Open note ${title}` }));
  await waitFor(() => expect(noteLayer()?.querySelector('.inline-body')).toBeTruthy());
  return noteLayer();
}

async function openSettings() {
  await fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
  await waitFor(() => expect(window.location.hash).toMatch(/settings$/));
}

async function closeSettings() {
  await fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
  await waitFor(() => expect(window.location.hash).not.toContain('settings'));
}

describe('상단 고정', () => {
  it('노트를 고정하면 고정 목록 맨 위로 올리고, 해제하면 내린다', async () => {
    saveWorkspaces();
    await renderReadyApp();
    const layer = await openNote('회의록');

    await fireEvent.click(layer.querySelector('[aria-keyshortcuts="P"]'));

    // 목록 제목은 편집기의 현재 제목(첫 줄 제목 방식이면 본문 첫 줄)을 따르므로 이슈 id로 확인한다.
    const pinnedIds = () => [...document.querySelectorAll('.note-list-pinned .note-row-hit-area')].map((node) => node.dataset.issueId);
    await waitFor(() => expect(pinnedIds()).toEqual(['20', '30']));
    expect(callsTo('addIssueLabel').map((args) => args.slice(2))).toEqual([[2, 'ginote:pin']]);

    await waitFor(() => expect(noteLayer().querySelector('[aria-keyshortcuts="P"]').disabled).toBe(false));
    await fireEvent.click(noteLayer().querySelector('[aria-keyshortcuts="P"]'));

    await waitFor(() => expect(pinnedIds()).toEqual(['30']));
    expect(callsTo('removeIssueLabel').map((args) => args.slice(2))).toEqual([[2, 'ginote:pin']]);
  });

  it('고정 요청이 실패하면 화면을 원래대로 되돌리고 이유를 알린다', async () => {
    saveWorkspaces();
    await renderReadyApp();
    githubModule.addIssueLabel.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const layer = await openNote('회의록');

    await fireEvent.click(layer.querySelector('[aria-keyshortcuts="P"]'));

    await waitFor(() => expect(document.querySelector('.sidebar-message')).not.toBeNull());
    expect(rowTitles('.note-list-pinned .note-list-row')).toEqual(['고정 메모']);
  });
});

describe('길게 누르기', () => {
  it('목록 행을 길게 누르면 그 노트를 골라 선택 모드로 들어가고, 뒤따르는 클릭은 무시한다', async () => {
    saveWorkspaces();
    await renderReadyApp();
    const row = [...document.querySelectorAll('.note-list-row')].find((node) => node.textContent.includes('장보기'));

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await fireEvent.pointerDown(row, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 10, clientY: 10 });
    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();

    await waitFor(() => expect(rowTitles('.note-list-row.selected')).toEqual(['장보기']));
    await fireEvent.click(row.querySelector('.note-row-hit-area'));
    expect(rowTitles('.note-list-row.selected')).toEqual(['장보기']);
    expect(window.location.hash).not.toContain('note.');
  });
});

describe('저장소 관리', () => {
  it('환경설정에서 다른 저장소를 추가하면 그 저장소로 전환한다', async () => {
    saveWorkspaces();
    await renderReadyApp();
    await openSettings();

    await fireEvent.click(screen.getByRole('button', { name: /Add another repository/ }));
    await fireEvent.input(screen.getByLabelText('Repository address'), { target: { value: 'octo/work' } });
    await fireEvent.click(screen.getByRole('button', { name: /Repository address entered/ }));
    await fireEvent.input(screen.getByLabelText('Fine-grained PAT'), { target: { value: 'ghp_work' } });
    await fireEvent.click(screen.getByRole('button', { name: /Complete setup/ }));

    await waitFor(() => expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)).workspaces.map((workspace) => workspace.repo)).toEqual(['octo/notes', 'octo/work']));
    await waitFor(() => expect(callsTo('verifyConnection').at(-1)).toEqual(['ghp_work', 'octo/work']));
    await waitFor(() => expect(document.querySelector('.workspace-wizard-overlay')).toBeNull());
  });

  it('저장소 이름을 바꾸고 순서를 옮기면 저장한다', async () => {
    saveWorkspaces([
      { id: 'ws-1', repo: 'octo/notes', token: 'ghp_test', rememberToken: true },
      { id: 'ws-2', repo: 'octo/work', token: 'ghp_work', rememberToken: true }
    ]);
    await renderReadyApp();
    await openSettings();

    await fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
    await fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[1]);
    const input = screen.getByRole('textbox', { name: /Display name for octo\/notes/ });
    await fireEvent.input(input, { target: { value: '개인 노트' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      expect(saved.workspaces.map((workspace) => [workspace.repo, workspace.displayName])).toEqual([['octo/work', ''], ['octo/notes', '개인 노트']]);
    });
  });

  it('현재 저장소의 연결을 해제하면 남은 저장소로 전환한다', async () => {
    saveWorkspaces([
      { id: 'ws-1', repo: 'octo/notes', token: 'ghp_test', rememberToken: true },
      { id: 'ws-2', repo: 'octo/work', token: 'ghp_work', rememberToken: true }
    ]);
    await renderReadyApp();
    await openSettings();

    await fireEvent.click(screen.getAllByRole('button', { name: 'Deauthorize' })[0]);

    await waitFor(() => expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)).workspaces.map((workspace) => workspace.id)).toEqual(['ws-2']));
    await waitFor(() => expect(callsTo('verifyConnection').at(-1)).toEqual(['ghp_work', 'octo/work']));
    expect(confirm).toHaveBeenCalled();
  });

  it('마지막 저장소까지 해제하면 처음 설정 화면으로 돌아간다', async () => {
    saveWorkspaces();
    await renderReadyApp();
    await openSettings();

    await fireEvent.click(screen.getByRole('button', { name: 'Deauthorize' }));

    await waitFor(() => expect(screen.getByText('Set up Ginote')).toBeTruthy());
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)).workspaces).toEqual([]);
  });
});

describe('태그 관리', () => {
  it('환경설정에서 태그를 만들고, 이름을 바꾸고, 지우면 목록의 노트에도 반영한다', async () => {
    saveWorkspaces();
    await renderReadyApp();
    await openSettings();

    const create = screen.getByRole('textbox', { name: 'Tag name: classification description' });
    await fireEvent.input(create, { target: { value: 'idea: 떠오른 생각' } });
    await fireEvent.keyDown(create, { key: 'Enter' });
    await waitFor(() => expect(callsTo('createLabel').at(-1).slice(2)).toEqual(['idea', { description: '떠오른 생각' }]));

    const rename = screen.getByRole('textbox', { name: 'work tag name' });
    await fireEvent.input(rename, { target: { value: 'job' } });
    await fireEvent.change(rename);
    await waitFor(() => expect(callsTo('renameLabel').at(-1).slice(2)).toEqual(['work', 'job', '']));

    const homeRow = screen.getByRole('textbox', { name: 'home tag name' }).closest('.tag-settings-row');
    await fireEvent.click(within(homeRow).getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(callsTo('removeLabel').at(-1)[2]).toBe('home'));

    await closeSettings();
    const tags = [...document.querySelectorAll('.note-row-labels span')].map((node) => node.textContent);
    expect(tags).toEqual(['#job']);
  });

  it('보고 있던 태그 이름이 바뀌면 새 이름의 태그 경로로 옮긴다', async () => {
    saveWorkspaces();
    history.replaceState(null, '', '/#!/tag.work');
    await renderReadyApp();
    await openSettings();

    const rename = screen.getByRole('textbox', { name: 'work tag name' });
    await fireEvent.input(rename, { target: { value: 'job' } });
    await fireEvent.change(rename);
    await waitFor(() => expect(callsTo('renameLabel')).toHaveLength(1));

    await closeSettings();
    await waitFor(() => expect(window.location.hash).toBe('#!/tag.job'));
  });
});

describe('붙여넣기와 휴지통', () => {
  it('목록에서 글을 붙여넣으면 그 글로 새 노트를 시작한다', async () => {
    saveWorkspaces();
    await renderReadyApp();

    const event = new Event('paste', { bubbles: true, cancelable: true });
    event.clipboardData = { files: [], getData: () => '붙여넣은 메모' };
    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(callsTo('createIssue')).toHaveLength(1));
    await waitFor(() => expect(noteLayer()?.querySelector('.inline-body')?.value).toContain('붙여넣은 메모'));
  });

  it('휴지통의 노트를 복원하면 휴지통 목록에서 뺀다', async () => {
    saveWorkspaces();
    await renderReadyApp();
    await fireEvent.click(screen.getByRole('button', { name: /Trash/ }));
    await waitFor(() => expect(rowTitles()).toEqual(['지난 메모']));
    const layer = await openNote('지난 메모');

    await fireEvent.click(layer.querySelector('[aria-keyshortcuts="Delete"]'));

    await waitFor(() => expect(callsTo('setIssueState')).toEqual([['ghp_test', 'octo/notes', 4, 'open']]));
    await waitFor(() => expect(rowTitles()).toEqual([]));
  });
});

describe('음성 기록', () => {
  const VOICE_SETTINGS_KEY = 'issue-note.voice-settings.v1';

  afterEach(() => {
    delete globalThis.__voiceRecording;
  });

  it('녹음한 내용으로 제안 제목과 저장소에 있는 태그만 붙인 새 노트를 만든다', async () => {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ apiKey: 'sk-test', refinementModel: 'gpt-4o-mini' }));
    githubModule.loadVoiceTranscriptionHints.mockResolvedValueOnce('Ginote');
    globalThis.__voiceRecording = { body: '첫 문장\n둘째 문장', tags: ['work', '없는 태그'], title: '  회의\n요약 ' };
    saveWorkspaces();
    await renderReadyApp();

    await fireEvent.click(screen.getByRole('button', { name: '음성 녹음' }));
    const recorder = await screen.findByTestId('voice-recorder');
    expect(window.location.hash).toBe('#!/voice');
    expect(recorder.dataset.hints).toBe('Ginote');
    expect(recorder.dataset.tags).toBe('work,home');

    await fireEvent.click(screen.getByRole('button', { name: '녹음 완료' }));

    await waitFor(() => expect(callsTo('createIssue')).toHaveLength(1));
    expect(callsTo('createIssue')[0][2]).toEqual({ title: '회의 요약', body: '회의 요약\n\n첫 문장\n\n둘째 문장', labels: ['work'] });
    await waitFor(() => expect(window.location.hash).toBe('#!/note.100'));
    expect(screen.queryByTestId('voice-recorder')).toBeNull();
  });

  it('녹음하던 중에 뒤로 가면 녹음을 버릴지 묻고, 취소하면 녹음 화면에 남는다', async () => {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ apiKey: 'sk-test' }));
    confirm.mockReturnValue(false);
    saveWorkspaces();
    await renderReadyApp();

    await fireEvent.click(screen.getByRole('button', { name: '음성 녹음' }));
    await screen.findByTestId('voice-recorder');
    await fireEvent.click(screen.getByRole('button', { name: '녹음 시작' }));

    history.back();

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() => expect(window.location.hash).toBe('#!/voice'));
    expect(screen.getByTestId('voice-recorder')).toBeTruthy();
  });
});

describe('화면 복귀와 사이드바', () => {
  it('다른 창에서 돌아오면 목록을 조용히 새로 읽는다', async () => {
    saveWorkspaces();
    await renderReadyApp();
    const before = listCalls().length;

    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(listCalls().length).toBe(before + 1));
    // 짧은 시간 안에 다시 돌아와도 중복 요청하지 않는다.
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listCalls().length).toBe(before + 1);
  });

  it('사이드바 경계를 끌어 너비를 바꾸면 저장한다', async () => {
    saveWorkspaces();
    await renderReadyApp();
    const handle = screen.getByRole('separator');

    await fireEvent.pointerDown(handle, { button: 0, clientX: 340 });
    await fireEvent.pointerMove(window, { clientX: 400 });
    await fireEvent.pointerUp(window);

    expect(localStorage.getItem('issue-note.sidebar-width.v1')).toBe('400');
    expect(document.querySelector('.note-workspace').style.getPropertyValue('--sidebar-width')).toBe('400px');
  });
});
