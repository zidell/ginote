import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import NoteList from './NoteList.svelte';
import { setAppLocale } from './i18n.js';

beforeAll(() => setAppLocale('en'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const listRowFields = { title: true, summary: true, meta: true, tags: true };

function issue(id, title = `노트 ${id}`) {
  return { id, number: id, title, body: '', labels: [], updated_at: '2026-09-01T00:00:00Z' };
}

function renderList(props = {}) {
  return render(NoteList, { listRowFields, emptyMessage: '노트가 없습니다', ...props });
}

function rowTitles(selector = '.note-list-row') {
  return [...document.querySelectorAll(`${selector} .note-row-title`)].map((node) => node.textContent.trim());
}

describe('NoteList 목록', () => {
  it('고정 노트를 따로 먼저 보여주고 그 아래에 나머지 노트를 보여준다', () => {
    renderList({ pinnedIssues: [issue(1, '고정')], issues: [issue(2, '둘'), issue(3, '셋')] });
    expect(rowTitles('.note-list-pinned .note-list-row')).toEqual(['고정']);
    expect(rowTitles()).toEqual(['고정', '둘', '셋']);
    expect(document.querySelector('.note-list-pinned .note-row-pin')).not.toBeNull();
  });

  it('노트가 없으면 안내를 보여주되, 불러오는 중에는 보여주지 않는다', async () => {
    const { rerender } = renderList();
    expect(screen.getByText('노트가 없습니다')).toBeTruthy();
    await rerender({ loading: true });
    expect(screen.queryByText('노트가 없습니다')).toBeNull();
    expect(screen.getByLabelText('Loading note list')).toBeTruthy();
  });

  it('선택·포커스·체크·새로고침·삭제 대기 상태를 각 행에 넘긴다', () => {
    renderList({
      issues: [issue(1), issue(2), issue(3)],
      selectedIssueId: 1,
      keyboardFocusedIssueId: '2',
      selectionMode: true,
      checkedIssueIds: new Set([2]),
      refreshingIssueNumber: 3,
      deletionEntries: [{ id: 9, issues: [issue(3)], inFlight: false }]
    });
    const rows = document.querySelectorAll('.note-list-row');
    expect(rows[0].classList.contains('active')).toBe(true);
    expect(rows[1].classList.contains('keyboard-focused')).toBe(true);
    expect(rows[1].classList.contains('selected')).toBe(true);
    expect(rows[2].classList.contains('pending-deletion')).toBe(true);
  });

  it('삭제 대기 행의 취소 버튼은 해당 대기 항목을 취소한다', async () => {
    const onCancelDeletion = vi.fn();
    renderList({ issues: [issue(1)], deletionEntries: [{ id: 9, issues: [issue(1)], inFlight: false }], onCancelDeletion });

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancelDeletion).toHaveBeenCalledWith(9);
  });

  it('처리 중인 삭제는 취소할 수 없다', () => {
    renderList({ issues: [issue(1)], deletionEntries: [{ id: 9, issues: [issue(1)], inFlight: true }] });
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('행의 포인터·클릭 이벤트를 넘겨받은 처리기로 보낸다', async () => {
    const rowHandlers = { pointerDown: vi.fn(), click: vi.fn() };
    const target = issue(1, '장보기');
    renderList({ issues: [target], rowHandlers });

    await fireEvent.pointerDown(document.querySelector('.note-list-row'));
    await fireEvent.click(screen.getByRole('button', { name: 'Open note 장보기' }));

    expect(rowHandlers.pointerDown).toHaveBeenCalledWith(expect.any(Event), target);
    expect(rowHandlers.click).toHaveBeenCalledWith(expect.any(Event), target);
  });
});

describe('NoteList 도구', () => {
  it('노트·휴지통 탭을 바꾸고, 선택 중에는 막는다', async () => {
    const onChangeState = vi.fn();
    const { rerender } = renderList({ state: 'open', onChangeState });

    const trash = screen.getByRole('button', { name: /Trash/ });
    await fireEvent.click(trash);
    expect(onChangeState).toHaveBeenCalledWith('closed');

    await rerender({ selectionMode: true });
    expect(trash.disabled).toBe(true);
  });

  it('새 노트와 음성 녹음 버튼을 부르고, 음성 키가 없으면 흐리게 보여준다', async () => {
    const onNewNote = vi.fn();
    const onVoiceRecording = vi.fn();
    renderList({ onNewNote, onVoiceRecording, voiceAvailable: false, newNoteShortcutAvailable: true });

    await fireEvent.click(screen.getByRole('button', { name: /New note/ }));
    const voice = screen.getByRole('button', { name: '음성 녹음' });
    await fireEvent.click(voice);

    expect(onNewNote).toHaveBeenCalledWith();
    expect(onVoiceRecording).toHaveBeenCalledWith();
    expect(voice.classList.contains('voice-unavailable')).toBe(true);
    expect(document.querySelector('.sidebar-new-note-shortcut .shortcut-key').classList.contains('is-available')).toBe(true);
  });

  it('새 노트를 만드는 중에는 두 버튼을 모두 막는다', () => {
    renderList({ newNoteDisabled: true });
    expect(screen.getByRole('button', { name: /New note/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '음성 녹음' }).disabled).toBe(true);
  });

  it('더 불러올 노트가 있으면 버튼을 두고, 검색 한도에 닿으면 안내한다', async () => {
    const onLoadMore = vi.fn();
    const { rerender } = renderList({ issues: [issue(1)], hasMore: true, onLoadMore });

    await fireEvent.click(screen.getByRole('button', { name: /Load more/ }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    await rerender({ hasMore: false, searchResultLimitReached: true });
    expect(screen.getByText('Search shows up to 100 results.')).toBeTruthy();
  });
});

describe('NoteList 스크롤', () => {
  function mockLayout(element, { scrollHeight, clientHeight }) {
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight });
  }

  it('목록 끝에 가까워지면 다음 페이지를 요청한다', async () => {
    const onLoadMore = vi.fn();
    renderList({ issues: [issue(1)], onLoadMore });
    const scroll = document.querySelector('.note-list-scroll');
    mockLayout(scroll, { scrollHeight: 2000, clientHeight: 500 });

    scroll.scrollTop = 1000;
    await fireEvent.scroll(scroll);
    expect(onLoadMore).not.toHaveBeenCalled();

    scroll.scrollTop = 1400;
    await fireEvent.scroll(scroll);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('처음에는 상단 도구를 숨겨 두고, 내리면 밀어 올리고, 맨 위로 오면 다시 보여준다', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height() {
      return this.classList.contains('sidebar-tools') ? 80 : 0;
    });
    renderList({ issues: [issue(1)] });
    const scroll = document.querySelector('.note-list-scroll');
    const tools = document.querySelector('.sidebar-tools');
    mockLayout(scroll, { scrollHeight: 5000, clientHeight: 500 });
    // 초기화는 다음 렌더 뒤에 도구 높이만큼 내려 두고, 한 프레임 뒤에 끝난다.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scroll.scrollTop).toBe(80);
    expect(tools.style.getPropertyValue('--sidebar-tools-offset')).toBe('80px');

    scroll.scrollTop = 30;
    await fireEvent.scroll(scroll);
    expect(tools.style.getPropertyValue('--sidebar-tools-offset')).toBe('30px');

    scroll.scrollTop = 300;
    await fireEvent.scroll(scroll);
    expect(tools.style.getPropertyValue('--sidebar-tools-offset')).toBe('80px');

    scroll.scrollTop = 0;
    await fireEvent.scroll(scroll);
    expect(tools.style.getPropertyValue('--sidebar-tools-offset')).toBe('0px');
    expect(tools.classList.contains('is-revealing')).toBe(true);
  });

  it('상단 도구 높이를 잴 수 없어도 초기화를 끝낸다', async () => {
    const { component } = renderList({ issues: [issue(1)] });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // 무한히 다시 초기화하지 않으므로 스크롤 위치는 그대로다.
    expect(document.querySelector('.note-list-scroll').scrollTop).toBe(0);
    expect(component.captureScroll().toolsOffset).toBe(0);
  });

  it('스크롤 위치를 보관했다가 되돌린다', async () => {
    const { component } = renderList({ issues: [issue(1), issue(2)] });
    const scroll = document.querySelector('.note-list-scroll');

    scroll.scrollTop = 120;
    const saved = component.captureScroll();
    expect(saved).toMatchObject({ scrollTop: 120 });

    scroll.scrollTop = 0;
    component.restoreScroll({ scrollTop: 240, toolsOffset: 12, toolsRevealing: true });
    expect(scroll.scrollTop).toBe(240);
    component.restoreScroll(null);
    expect(scroll.scrollTop).toBe(240);
  });

  it('키보드 이동에 쓸 행 버튼과 목록 영역을 내어 준다', () => {
    const { component } = renderList({ pinnedIssues: [issue(1)], issues: [issue(2)] });
    expect(component.rowButtons().map((button) => button.dataset.issueId)).toEqual(['1', '2']);
    expect(component.viewportBounds()).not.toBeNull();
  });
});
