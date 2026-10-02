import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import HelpOverlay from './HelpOverlay.svelte';
import { setAppLocale, translate } from './i18n.js';

beforeAll(() => setAppLocale('en'));
afterEach(cleanup);

describe('HelpOverlay', () => {
  it.each([
    ['security', 'help.securityTitle'],
    ['keyboard', 'help.keyboardTitle'],
    ['app', 'help.appTitle'],
    ['mcp', 'm.5fe5834eaa']
  ])('%s 주제의 제목을 보여준다', (topic, titleKey) => {
    render(HelpOverlay, { topic });
    expect(screen.getByRole('heading', { level: 2 }).textContent.trim()).toBe(translate(titleKey));
  });

  it('보안 안내는 README로 가는 링크를 둔다', () => {
    render(HelpOverlay, { topic: 'security' });
    expect(screen.getByRole('link', { name: /README/ }).getAttribute('href')).toBe('https://github.com/zidell/ginote#readme');
  });

  it('MCP 안내에 저장소와 복사 기능을 넘긴다', async () => {
    const onCopy = vi.fn();
    render(HelpOverlay, { topic: 'mcp', mcpRepository: 'octo/notes', mcpUsagePrompt: '노트 사용법', onCopy });
    expect(screen.getByDisplayValue('octo/notes')).toBeTruthy();
  });

  it('닫기 버튼과 바깥 영역 클릭으로 닫는다', async () => {
    const onClose = vi.fn();
    render(HelpOverlay, { topic: 'app', onClose });

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await fireEvent.click(document.querySelector('.help-overlay'));
    await fireEvent.click(document.querySelector('.help-overlay .card'));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
