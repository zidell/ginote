import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import TagSettings from './TagSettings.svelte';
import { setAppLocale } from './i18n.js';

beforeAll(() => setAppLocale('en'));
afterEach(cleanup);

describe('TagSettings', () => {
  it('한 태그의 저장이 끝나기 전에도 다음 태그 편집을 시작한다', async () => {
    const onRename = vi.fn(() => new Promise(() => {}));
    render(TagSettings, {
      labels: [{ id: 1, name: 'work' }, { id: 2, name: 'culture' }],
      onRename
    });

    const work = screen.getByRole('textbox', { name: 'work tag name' });
    const culture = screen.getByRole('textbox', { name: 'culture tag name' });
    await fireEvent.input(work, { target: { value: 'work: projects and meetings' } });
    await tick();
    await fireEvent.change(work);
    await fireEvent.input(culture, { target: { value: 'culture: books and films' } });
    await tick();
    await fireEvent.change(culture);

    expect(onRename).toHaveBeenNthCalledWith(1, { id: 1, name: 'work' }, {
      name: 'work', description: 'projects and meetings'
    });
    expect(onRename).toHaveBeenNthCalledWith(2, { id: 2, name: 'culture' }, {
      name: 'culture', description: 'books and films'
    });
  });

  it('백그라운드 저장 중인 태그도 계속 편집할 수 있다', async () => {
    const onRename = vi.fn(() => new Promise(() => {}));
    render(TagSettings, {
      labels: [{ id: 1, name: 'work' }],
      onRename
    });

    const input = screen.getByRole('textbox', { name: 'work tag name' });
    await fireEvent.input(input, { target: { value: 'work: projects' } });
    await tick();
    await fireEvent.change(input);
    await tick();
    expect(input.disabled).toBe(false);
    expect(screen.getByRole('textbox', { name: 'work tag name' }).parentElement.getAttribute('aria-busy')).toBe('true');
  });

  it('저장 Promise가 끝나면 스피너 상태를 해제한다', async () => {
    let finishSave;
    const onRename = vi.fn(() => new Promise((resolve) => { finishSave = resolve; }));
    render(TagSettings, { labels: [{ id: 1, name: 'work' }], onRename });

    const input = screen.getByRole('textbox', { name: 'work tag name' });
    await fireEvent.input(input, { target: { value: 'work: projects' } });
    await tick();
    await fireEvent.change(input);
    await tick();
    expect(screen.getByRole('textbox', { name: 'work tag name' }).parentElement.getAttribute('aria-busy')).toBe('true');

    finishSave(true);
    await tick();
    await tick();
    expect(screen.getByRole('textbox', { name: 'work tag name' }).parentElement.getAttribute('aria-busy')).toBe('false');
  });

  it('blur 없이 사라져도 입력한 태그 정의를 저장한다', async () => {
    const onRename = vi.fn().mockResolvedValue(true);
    const { unmount } = render(TagSettings, { labels: [{ id: 1, name: 'work' }], onRename });
    const input = screen.getByRole('textbox', { name: 'work tag name' });
    await fireEvent.input(input, { target: { value: 'work: projects' } });

    unmount();
    expect(onRename).toHaveBeenCalledWith({ id: 1, name: 'work' }, {
      name: 'work', description: 'projects'
    });
  });
});
