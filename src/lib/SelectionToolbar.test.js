import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import SelectionToolbar from './SelectionToolbar.svelte';
import { setAppLocale } from './i18n.js';

beforeAll(() => setAppLocale('en'));
afterEach(cleanup);

function button(name) {
  return screen.getByRole('button', { name, hidden: true });
}

describe('SelectionToolbar', () => {
  it('선택 중이 아니면 숨기고 탭 이동에서도 뺀다', () => {
    render(SelectionToolbar, { active: false });
    const toolbar = document.querySelector('.sidebar-selection-toolbar');
    expect(toolbar.getAttribute('aria-hidden')).toBe('true');
    expect(button(/Merge/).tabIndex).toBe(-1);
  });

  it('두 개 이상 골라야 병합할 수 있고, 이유를 제목으로 알린다', () => {
    render(SelectionToolbar, { active: true, selectedCount: 1 });
    expect(button(/Merge/).disabled).toBe(true);
    expect(button(/Merge/).title).toBe('Select at least two notes to merge.');
  });

  it('휴지통에서는 병합 대신 복원만 할 수 있다', () => {
    render(SelectionToolbar, { active: true, state: 'closed', selectedCount: 3 });
    expect(button(/Merge/).disabled).toBe(true);
    expect(button(/Merge/).title).toBe('Restore notes before merging them.');
    expect(document.querySelector('.btn-outline-danger .bi-arrow-counterclockwise')).not.toBeNull();
  });

  it('다른 작업이 진행 중이면 일괄 작업을 막는다', () => {
    render(SelectionToolbar, { active: true, selectedCount: 3, busy: true });
    expect(button(/Merge/).disabled).toBe(true);
    expect(document.querySelector('.btn-outline-danger').disabled).toBe(true);
  });

  it('각 버튼이 해당 작업을 부른다', async () => {
    const handlers = { onToggleTags: vi.fn(), onMerge: vi.fn(), onMove: vi.fn(), onCancel: vi.fn() };
    render(SelectionToolbar, { active: true, selectedCount: 2, tagPanelOpen: true, ...handlers });

    const tagButton = button(/Tags/);
    expect(tagButton.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(tagButton);
    await fireEvent.click(button(/Merge/));
    await fireEvent.click(document.querySelector('.btn-outline-danger'));
    await fireEvent.click(button('Close'));

    expect(handlers.onToggleTags).toHaveBeenCalledTimes(1);
    expect(handlers.onMerge).toHaveBeenCalledTimes(1);
    expect(handlers.onMove).toHaveBeenCalledTimes(1);
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });
});
