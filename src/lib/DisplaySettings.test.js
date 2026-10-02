import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import DisplaySettings from './DisplaySettings.svelte';
import { setAppLocale } from './i18n.js';
import { normalizePreferences } from './settings-storage.js';

beforeAll(() => setAppLocale('en'));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAppLocale('en');
  document.documentElement.className = '';
});

function renderSettings(overrides = {}, props = {}) {
  const preferences = normalizePreferences({ language: 'en', ...overrides });
  const result = render(DisplaySettings, { preferences, ...props });
  return { ...result, preferences };
}

describe('DisplaySettings', () => {
  it('저장된 환경설정 값을 보여준다', () => {
    renderSettings({ titleMode: 'separate', editorFontSize: 20, issuePageSize: 50, listRowFields: { tags: false } });
    expect(document.getElementById('title-mode').value).toBe('separate');
    expect(document.getElementById('font-size').value).toBe('20');
    expect(document.getElementById('issue-page-size').value).toBe('50');
    expect(document.getElementById('list-field-tags').checked).toBe(false);
    expect(document.getElementById('list-field-title').checked).toBe(true);
  });

  it('입력한 값을 환경설정 객체에 반영하고 적용 시점을 알린다', async () => {
    const onDeferredChange = vi.fn();
    const { preferences } = renderSettings({}, { onDeferredChange });

    const pageSize = document.getElementById('issue-page-size');
    await fireEvent.input(pageSize, { target: { value: '70' } });
    await fireEvent.change(pageSize);
    await fireEvent.click(document.getElementById('list-field-summary'));
    await fireEvent.change(document.getElementById('list-field-summary'));

    expect(preferences.issuePageSize).toBe(70);
    expect(preferences.listRowFields.summary).toBe(false);
    expect(onDeferredChange).toHaveBeenCalled();
  });

  it('테마는 고르는 즉시 화면에 적용한다', async () => {
    const onDeferredChange = vi.fn();
    const { preferences } = renderSettings({ theme: 'dark' }, { onDeferredChange });

    const theme = document.getElementById('theme');
    theme.value = 'light';
    await fireEvent.change(theme);

    expect(preferences.theme).toBe('light');
    expect(document.documentElement.classList.contains('mode-light')).toBe(true);
    expect(onDeferredChange).toHaveBeenCalledTimes(1);
  });

  it('언어는 고르는 즉시 화면 언어를 바꾼다', async () => {
    const { preferences } = renderSettings();

    const language = document.getElementById('language');
    language.value = 'ko';
    await fireEvent.change(language);

    expect(preferences.language).toBe('ko');
    await waitFor(() => expect(screen.getByLabelText('언어')).toBeTruthy());
  });

  it('글꼴 목록을 열면 이 기기의 글꼴을 불러와 보여준다', async () => {
    vi.stubGlobal('queryLocalFonts', vi.fn(async () => [{ family: 'Pretendard' }, { family: 'Arial' }, { family: 'Arial' }, { family: '' }]));
    renderSettings();

    await fireEvent.focus(document.getElementById('editor-font'));

    await waitFor(() => expect(screen.getByRole('option', { name: 'Pretendard' })).toBeTruthy());
    const localGroup = document.querySelector('optgroup[label="Local Fonts"]');
    expect([...localGroup.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Arial', 'Pretendard']);
  });

  it('글꼴 목록을 읽을 수 없어도 기본 글꼴은 고를 수 있다', async () => {
    vi.stubGlobal('queryLocalFonts', vi.fn(async () => { throw new Error('denied'); }));
    renderSettings();

    await fireEvent.focus(document.getElementById('editor-font'));

    expect(document.querySelector('optgroup[label="Local Fonts"]')).toBeNull();
    expect(screen.getByRole('option', { name: 'System default' })).toBeTruthy();
  });
});
