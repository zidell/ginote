import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import WorkspaceSwitcher from './WorkspaceSwitcher.svelte';
import { setAppLocale } from './i18n.js';

beforeAll(() => {
  setAppLocale('en');
});

// @testing-library/svelte의 자동 cleanup은 전역 beforeEach/afterEach(vitest globals)에
// 의존하는데 이 프로젝트는 globals를 켜지 않았으므로 각 테스트 파일에서 직접 호출한다.
afterEach(cleanup);

function workspaces() {
  return [
    { id: 'a', repo: 'zidell/ginote', token: 't1', rememberToken: true },
    { id: 'b', repo: 'zidell/other-project', token: 't2', rememberToken: true }
  ];
}

describe('WorkspaceSwitcher', () => {
  it('user가 없으면 아바타 이미지 없이 비활성 버튼만 렌더링한다', () => {
    render(WorkspaceSwitcher, { workspaces: [], activeWorkspaceId: '', user: null });
    const button = screen.getByRole('button', { name: 'Switch workspace' });
    expect(button.disabled).toBe(true);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('버튼을 누르면 워크스페이스 목록이 있는 드롭다운이 열린다', async () => {
    render(WorkspaceSwitcher, {
      workspaces: workspaces(),
      activeWorkspaceId: 'a',
      user: { login: 'zidell', avatar_url: 'https://example.com/a.png' }
    });

    expect(screen.queryByRole('listbox')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }));

    const list = screen.getByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain('zidell/ginote');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].textContent).toContain('zidell/other-project');
    expect(options[1].getAttribute('aria-selected')).toBe('false');
    expect(options[0].textContent).toMatch(/1/);
    expect(options[1].textContent).toMatch(/2/);
  });

  it('다른 워크스페이스를 클릭하면 onSwitch를 호출하고 드롭다운을 닫는다', async () => {
    const onSwitch = vi.fn();
    render(WorkspaceSwitcher, {
      workspaces: workspaces(),
      activeWorkspaceId: 'a',
      user: { login: 'zidell', avatar_url: 'https://example.com/a.png' },
      onSwitch
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await fireEvent.click(screen.getByRole('option', { name: /other-project/ }));

    expect(onSwitch).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('활성 워크스페이스를 다시 클릭해도 onSwitch를 호출하지 않는다', async () => {
    const onSwitch = vi.fn();
    render(WorkspaceSwitcher, {
      workspaces: workspaces(),
      activeWorkspaceId: 'a',
      user: { login: 'zidell', avatar_url: 'https://example.com/a.png' },
      onSwitch
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await fireEvent.click(screen.getByRole('option', { name: /ginote/ }));

    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('백틱으로 열고 방향키와 엔터로 워크스페이스를 전환한다', async () => {
    const onSwitch = vi.fn();
    render(WorkspaceSwitcher, {
      workspaces: workspaces(),
      activeWorkspaceId: 'a',
      user: { login: 'zidell', avatar_url: 'https://example.com/a.png' },
      onSwitch
    });

    await fireEvent.keyDown(window, { key: '`', code: 'Backquote' });
    const list = screen.getByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(document.activeElement).toBe(options[0]);

    await fireEvent.keyDown(window, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    await fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });

    expect(onSwitch).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('입력 필드에 포커스가 있으면 백틱을 입력할 수 있다', async () => {
    render(WorkspaceSwitcher, {
      workspaces: workspaces(),
      activeWorkspaceId: 'a',
      user: { login: 'zidell', avatar_url: 'https://example.com/a.png' }
    });
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    await fireEvent.keyDown(window, { key: '`', code: 'Backquote' });

    expect(screen.queryByRole('listbox')).toBeNull();
    input.remove();
  });
});
