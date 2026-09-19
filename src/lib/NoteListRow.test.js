import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import NoteListRow from './NoteListRow.svelte';
import { setAppLocale } from './i18n.js';

beforeAll(() => {
  setAppLocale('en');
});

afterEach(cleanup);

function issue(overrides = {}) {
  return {
    id: 101,
    number: 7,
    title: '장보기 목록',
    body: '# 장보기 목록\n\n- 우유\n- **계란**',
    updated_at: '2026-09-01T03:04:05Z',
    labels: [{ id: 1, name: 'todo' }, { id: 2, name: 'ginote:pin' }],
    ...overrides
  };
}

function renderRow(props = {}) {
  return render(NoteListRow, { issue: issue(), ...props });
}

describe('NoteListRow', () => {
  it('제목, 제목을 뺀 요약, 번호와 태그를 보여준다', () => {
    const { container } = renderRow();

    expect(container.querySelector('.note-row-title').textContent.trim()).toBe('장보기 목록');
    const preview = container.querySelector('.note-row-preview').textContent;
    expect(preview).not.toContain('장보기 목록');
    expect(preview).toContain('우유');
    expect(preview).toContain('계란');
    expect(preview).not.toContain('**');
    expect(container.querySelector('.note-row-meta').textContent).toMatch(/^\s*#7 · /);
  });

  it('상단고정용 내부 라벨은 태그 목록에 드러내지 않는다', () => {
    const { container } = renderRow();
    const tags = [...container.querySelectorAll('.note-row-labels span')].map((node) => node.textContent);
    expect(tags).toEqual(['#todo']);
  });

  it('보여줄 태그가 없으면 태그 영역을 그리지 않는다', () => {
    const { container } = renderRow({ issue: issue({ labels: [{ id: 2, name: 'ginote:pin' }] }) });
    expect(container.querySelector('.note-row-labels')).toBeNull();
  });

  it('본문이 비었거나 제목과 같으면 내용 없음 안내를 보여준다', () => {
    const { container } = renderRow({ issue: issue({ body: '# 장보기 목록' }) });
    expect(container.querySelector('.note-row-preview').textContent).toBe('No content.');
    cleanup();
    const second = renderRow({ issue: issue({ body: null }) });
    expect(second.container.querySelector('.note-row-preview').textContent).toBe('No content.');
  });

  it('잠긴 노트는 자물쇠만 표시하고 본문 요약을 노출하지 않는다', () => {
    const { container } = renderRow({ issue: issue({ title: '🔒 비밀 메모', body: 'AgEC암호문' }) });

    expect(container.querySelector('.note-row-lock')).not.toBeNull();
    expect(container.querySelector('.note-row-title').textContent.trim()).toBe('비밀 메모');
    const preview = container.querySelector('.note-row-preview').textContent;
    expect(preview).not.toContain('AgEC');
  });

  it('고정된 노트에만 핀 아이콘을 표시한다', () => {
    const { container } = renderRow({ pinned: true });
    expect(container.querySelector('.note-row-pin')).not.toBeNull();
    cleanup();
    expect(renderRow().container.querySelector('.note-row-pin')).toBeNull();
  });

  it('로컬 초안은 번호 대신 초안 표시를 하고 선택 체크박스를 두지 않는다', () => {
    const { container } = renderRow({ issue: issue({ local: true }), selectionMode: true });
    expect(container.querySelector('.note-row-meta').textContent.trim()).toBe('Local draft');
    expect(container.querySelector('.note-row-checkbox')).toBeNull();
  });

  it('설정에서 끈 항목은 그리지 않는다', () => {
    const { container } = renderRow({ listRowFields: { title: true, summary: false, meta: false, tags: false } });
    expect(container.querySelector('.note-row-title')).not.toBeNull();
    expect(container.querySelector('.note-row-preview')).toBeNull();
    expect(container.querySelector('.note-row-meta')).toBeNull();
    expect(container.querySelector('.note-row-labels')).toBeNull();
  });

  it('상태를 클래스와 aria-busy로 반영한다', () => {
    const { container } = renderRow({ selected: true, keyboardFocused: true, checked: true, archived: true, refreshing: true });
    const row = container.querySelector('.note-list-row');
    for (const name of ['active', 'keyboard-focused', 'selected', 'is-archived']) {
      expect(row.classList.contains(name)).toBe(true);
    }
    expect(row.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByLabelText('Loading note list')).toBeTruthy();
  });

  it('행을 누르면 해당 노트와 함께 클릭 콜백을 부른다', async () => {
    const onClick = vi.fn();
    const target = issue();
    renderRow({ issue: target, onClick });

    await fireEvent.click(screen.getByRole('button', { name: 'Open note 장보기 목록' }));
    expect(onClick).toHaveBeenCalledWith(expect.any(Event), target);
  });

  it('선택 모드의 체크박스는 행 클릭과 별개로 선택 콜백만 부른다', async () => {
    const onClick = vi.fn();
    const onSelectionClick = vi.fn();
    const target = issue();
    const { container } = renderRow({ issue: target, selectionMode: true, onClick, onSelectionClick });

    await fireEvent.click(container.querySelector('.note-row-checkbox'));
    expect(onSelectionClick).toHaveBeenCalledWith(expect.any(Event), target);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('포인터와 컨텍스트 메뉴 이벤트를 넘긴다', async () => {
    const handlers = {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
      onContextMenu: vi.fn()
    };
    const target = issue();
    const { container } = renderRow({ issue: target, ...handlers });
    const row = container.querySelector('.note-list-row');

    await fireEvent.pointerDown(row);
    await fireEvent.pointerMove(row);
    await fireEvent.pointerUp(row);
    await fireEvent.pointerCancel(row);
    await fireEvent.contextMenu(row);

    expect(handlers.onPointerDown).toHaveBeenCalledWith(expect.any(Event), target);
    expect(handlers.onPointerMove).toHaveBeenCalledTimes(1);
    expect(handlers.onPointerUp).toHaveBeenCalledTimes(1);
    expect(handlers.onPointerCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onContextMenu).toHaveBeenCalledWith(expect.any(Event), target);
  });

  it('삭제 대기 중에는 오버레이를 띄우고, 취소할 수 있을 때만 취소 버튼을 준다', async () => {
    const onCancelDeletion = vi.fn();
    const onClick = vi.fn();
    const target = issue();
    const { container } = renderRow({ issue: target, pendingDeletion: true, deletionCancellable: true, refreshing: true, onCancelDeletion, onClick });

    expect(container.querySelector('.note-list-row').classList.contains('pending-deletion')).toBe(true);
    expect(container.querySelector('.note-row-deletion-overlay')).not.toBeNull();
    // 삭제 오버레이가 있으면 새로고침 스피너는 겹쳐 그리지 않는다.
    expect(container.querySelector('.note-row-refresh-spinner')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancelDeletion).toHaveBeenCalledWith(target);
    expect(onClick).not.toHaveBeenCalled();

    cleanup();
    renderRow({ pendingDeletion: true, deletionCancellable: false });
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});
