import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import SidebarSearch from './SidebarSearch.svelte';
import { setAppLocale } from './i18n.js';

beforeAll(() => setAppLocale('en'));
afterEach(cleanup);

const labels = [{ id: 1, name: 'work' }, { id: 2, name: 'home' }, { id: 3, name: 'homework' }];

function suggestions() {
  return screen.queryAllByRole('option').map((option) => option.textContent);
}

async function focusAndType(value) {
  const input = screen.getByRole('combobox');
  await fireEvent.focus(input);
  await fireEvent.input(input, { target: { value } });
  return input;
}

describe('SidebarSearch', () => {
  it('포커스된 동안 입력과 맞는 태그를 제안한다', async () => {
    render(SidebarSearch, { labels });
    expect(suggestions()).toEqual([]);

    const input = await focusAndType('#HOME');
    expect(suggestions()).toEqual(['#home', '#homework']);
    expect(input.getAttribute('aria-expanded')).toBe('true');

    await fireEvent.blur(input);
    expect(suggestions()).toEqual([]);
  });

  it('↑/↓로 제안을 돌아가며 고르고 Enter로 적용한다', async () => {
    const onSelectLabel = vi.fn();
    render(SidebarSearch, { labels, onSelectLabel });
    const input = await focusAndType('work');

    await fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { selected: true }).textContent).toBe('#homework');
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { selected: true }).textContent).toBe('#work');

    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelectLabel).toHaveBeenCalledWith(labels[0]);
    expect(suggestions()).toEqual([]);
  });

  it('제안을 고르지 않은 Enter는 검색 제출로 넘긴다', async () => {
    const onSubmit = vi.fn();
    render(SidebarSearch, { labels, onSubmit });
    const input = await focusAndType('회의');

    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    await fireEvent.submit(input.closest('form'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Esc는 제안만 닫는다', async () => {
    render(SidebarSearch, { labels });
    const input = await focusAndType('ho');
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(suggestions()).toEqual([]);
    expect(input.value).toBe('ho');
  });

  it('제안을 누르면 그 태그를 적용한다', async () => {
    const onSelectLabel = vi.fn();
    render(SidebarSearch, { labels, onSelectLabel });
    await focusAndType('home');

    await fireEvent.click(screen.getByRole('option', { name: '#homework' }));
    expect(onSelectLabel).toHaveBeenCalledWith(labels[2]);
  });

  it('비활성화되면 입력과 제안을 막는다', async () => {
    render(SidebarSearch, { labels, disabled: true });
    expect(screen.getByRole('combobox').disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Search/ }).disabled).toBe(true);
  });
});
