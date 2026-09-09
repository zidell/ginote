import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import TagPicker from './TagPicker.svelte';
import { setAppLocale } from './i18n.js';

beforeAll(() => {
  setAppLocale('en');
});

afterEach(cleanup);

describe('TagPicker', () => {
  it('이미 선택된 태그도 목록에 표시하고 선택 상태를 알린다', async () => {
    const onSelect = vi.fn();
    render(TagPicker, {
      availableLabels: [{ name: 'work' }, { name: 'idea' }],
      selectedLabels: ['work'],
      onSelect
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    const selected = screen.getByRole('button', { name: '#work' });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(selected);
    expect(onSelect).toHaveBeenCalledWith('work');
  });

  it('pin 시스템 라벨은 태그 선택기에서 숨긴다', async () => {
    render(TagPicker, {
      availableLabels: [{ name: 'work' }, { name: 'ginote:pin' }],
      selectedLabels: ['ginote:pin']
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByRole('button', { name: '#work' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '#ginote:pin' })).toBeNull();
  });

  it('Escape는 검색창이 제거되기 전에 전역 뒤로 가기로 전파되지 않는다', async () => {
    const onWindowKeyup = vi.fn();
    window.addEventListener('keyup', onWindowKeyup);
    render(TagPicker, { availableLabels: [{ name: 'work' }] });

    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const input = screen.getByRole('textbox');
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    await fireEvent.keyUp(input, { key: 'Escape' });
    expect(onWindowKeyup).not.toHaveBeenCalled();
    window.removeEventListener('keyup', onWindowKeyup);
  });

  it('선택 상태가 바뀌어도 태그 목록 순서를 유지한다', async () => {
    const { rerender } = render(TagPicker, {
      availableLabels: [{ name: 'work' }, { name: 'idea' }],
      selectedLabels: ['idea']
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const optionNames = () => [...document.querySelectorAll('.tag-dropdown-list > button:not(.create-tag)')]
      .map((button) => button.textContent.trim());

    expect(optionNames()).toEqual(['#work', '#idea']);
    await rerender({ selectedLabels: ['work'] });
    expect(optionNames()).toEqual(['#work', '#idea']);
  });

  it('상단 툴바 태그 선택기도 Escape에서 드롭다운을 즉시 닫는다', async () => {
    render(TagPicker, { toolbar: true, availableLabels: [{ name: 'work' }] });

    await fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    const input = screen.getByRole('textbox');
    input.focus();
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).not.toBe(input);
  });

  it('검색 input 대신 태그 버튼에 포커스가 있어도 Escape에서 포커스와 드롭다운을 함께 닫는다', async () => {
    render(TagPicker, { toolbar: true, availableLabels: [{ name: 'work' }] });

    const button = screen.getByRole('button', { name: 'Tags' });
    await fireEvent.click(button);
    button.focus();
    await fireEvent.keyDown(button, { key: 'Escape' });

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).not.toBe(button);
  });

  it('검색 중 위아래 키로 현재 표시된 제안을 순환 선택하고 Enter로 적용한다', async () => {
    const onSelect = vi.fn();
    render(TagPicker, {
      availableLabels: [{ name: 'idea' }, { name: 'later' }, { name: 'theme' }],
      onSelect
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'e' } });

    const arrowDown = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    input.dispatchEvent(arrowDown);
    expect(arrowDown.defaultPrevented).toBe(true);
    await tick();
    expect(screen.getByRole('button', { name: '#idea' }).classList.contains('keyboard-focused')).toBe(true);

    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: '#later' }).classList.contains('keyboard-focused')).toBe(true);
    await fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('button', { name: '#idea' }).classList.contains('keyboard-focused')).toBe(true);

    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('idea');
  });
});
