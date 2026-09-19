import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import SelectionTagPanel from './SelectionTagPanel.svelte';
import { setAppLocale } from './i18n.js';

beforeAll(() => setAppLocale('en'));
afterEach(cleanup);

const labels = [{ name: 'work' }, { name: 'home' }, { name: 'idea' }];
const selectedIssues = [
  { id: 1, labels: [{ name: 'work' }, { name: 'home' }] },
  { id: 2, labels: [{ name: 'Work' }] }
];

function optionNames() {
  return [...document.querySelectorAll('.selection-tag-name')].map((node) => node.textContent);
}

describe('SelectionTagPanel', () => {
  it('선택한 노트에 붙은 태그를 먼저, 붙은 개수와 함께 보여준다', () => {
    render(SelectionTagPanel, { labels, selectedIssues });
    expect(optionNames()).toEqual(['#home', '#work', '#idea']);
    expect([...document.querySelectorAll('.selection-tag-count')].map((node) => node.textContent)).toEqual(['1/2', '2/2']);
  });

  it('모두에게 붙은 태그는 떼고, 일부만 붙었거나 없는 태그는 붙인다', async () => {
    const onApply = vi.fn();
    render(SelectionTagPanel, { labels, selectedIssues, onApply });

    await fireEvent.click(screen.getByRole('button', { name: /#work/ }));
    await fireEvent.click(screen.getByRole('button', { name: /#home/ }));
    await fireEvent.click(screen.getByRole('button', { name: /#idea/ }));

    expect(onApply.mock.calls).toEqual([['work', 'remove'], ['home', 'add'], ['idea', 'add']]);
  });

  it('검색어로 거르고, 없는 이름이면 새 태그를 만들 수 있게 한다', async () => {
    const onApply = vi.fn();
    render(SelectionTagPanel, { labels, selectedIssues, onApply });

    const search = screen.getByRole('textbox');
    await fireEvent.input(search, { target: { value: 'wo' } });
    expect(optionNames()).toEqual(['#work']);
    expect(screen.getByRole('button', { name: 'Create #wo' })).toBeTruthy();

    await fireEvent.input(search, { target: { value: 'WORK' } });
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull();

    await fireEvent.input(search, { target: { value: '#새 태그' } });
    const create = screen.getByRole('button', { name: /Create/ });
    await fireEvent.click(create);
    expect(onApply).toHaveBeenCalledWith(expect.stringContaining('새'), 'add');
  });

  it('작업 중에는 모든 버튼을 막는다', () => {
    render(SelectionTagPanel, { labels, selectedIssues, busy: true });
    expect([...document.querySelectorAll('.selection-tag-list button')].every((node) => node.disabled)).toBe(true);
    expect(document.querySelector('.sidebar-selection-tags').classList.contains('is-busy')).toBe(true);
  });
});
