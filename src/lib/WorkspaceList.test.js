import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import WorkspaceList from './WorkspaceList.svelte';
import { setAppLocale } from './i18n.js';

beforeAll(() => {
  setAppLocale('en');
});

afterEach(cleanup);

function workspaces() {
  return [
    { id: 'a', repo: 'zidell/ginote' },
    { id: 'b', repo: 'zidell/other-project' },
    { id: 'c', repo: 'zidell/third-project' }
  ];
}

describe('WorkspaceList', () => {
  it('워크스페이스를 순서대로 렌더링하고, 활성 워크스페이스에 배지를 표시한다', () => {
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'b' });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[1].textContent).toContain('zidell/other-project');
    expect(within(items[1]).getByText('Current')).toBeTruthy();
    expect(within(items[0]).queryByText('Current')).toBeNull();
  });

  it('첫 항목은 위로 이동 버튼이, 마지막 항목은 아래로 이동 버튼이 비활성화된다', () => {
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'a' });
    const items = screen.getAllByRole('listitem');

    expect(within(items[0]).getByRole('button', { name: 'Move up' }).disabled).toBe(true);
    expect(within(items[0]).getByRole('button', { name: 'Move down' }).disabled).toBe(false);
    expect(within(items[2]).getByRole('button', { name: 'Move down' }).disabled).toBe(true);
    expect(within(items[2]).getByRole('button', { name: 'Move up' }).disabled).toBe(false);
  });

  it('위/아래 버튼을 누르면 onMove를 해당 방향과 함께 호출한다', async () => {
    const onMove = vi.fn();
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'a', onMove });
    const items = screen.getAllByRole('listitem');

    await fireEvent.click(within(items[1]).getByRole('button', { name: 'Move up' }));
    expect(onMove).toHaveBeenCalledWith('b', 'up');

    await fireEvent.click(within(items[1]).getByRole('button', { name: 'Move down' }));
    expect(onMove).toHaveBeenCalledWith('b', 'down');
  });

  it('워크스페이스가 1개뿐이면 위/아래 버튼이 모두 비활성화된다', () => {
    render(WorkspaceList, { workspaces: [workspaces()[0]], activeWorkspaceId: 'a' });
    const item = screen.getByRole('listitem');

    expect(within(item).getByRole('button', { name: 'Move up' }).disabled).toBe(true);
    expect(within(item).getByRole('button', { name: 'Move down' }).disabled).toBe(true);
  });

  it('더보기 드롭다운의 인증해제 항목을 누르면 아코디언 토글 없이 onLeave만 호출된다', async () => {
    const onLeave = vi.fn();
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'a', onLeave });
    const items = screen.getAllByRole('listitem');

    await fireEvent.click(within(items[2]).getByRole('button', { name: 'More actions' }));
    await fireEvent.click(within(items[2]).getByRole('button', { name: 'Deauthorize' }));
    expect(onLeave).toHaveBeenCalledWith('c');
    expect(within(items[2]).getByRole('button', { name: /zidell\/third-project/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('기본적으로 활성 워크스페이스가 펼쳐져 있고 태그 관리가 보인다', () => {
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'b' });
    const items = screen.getAllByRole('listitem');

    expect(within(items[1]).getByRole('button', { name: /zidell\/other-project/ }).getAttribute('aria-expanded')).toBe('true');
    expect(within(items[1]).getByText('Manage tags')).toBeTruthy();
    expect(within(items[0]).getByRole('button', { name: /zidell\/ginote/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('비활성 워크스페이스를 펼치면 전환 안내와 버튼이 보이고, 클릭하면 onSwitch를 호출한다', async () => {
    const onSwitch = vi.fn();
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'a', onSwitch });
    const items = screen.getAllByRole('listitem');

    await fireEvent.click(within(items[1]).getByRole('button', { name: /zidell\/other-project/ }));
    expect(within(items[1]).queryByText('Manage tags')).toBeNull();
    const switchButton = within(items[1]).getByRole('button', { name: 'Switch' });
    await fireEvent.click(switchButton);
    expect(onSwitch).toHaveBeenCalledWith('b');
  });

  it('다른 워크스페이스를 펼치면 이전에 펼쳐져 있던 것은 접힌다(아코디언)', async () => {
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'a' });
    const items = screen.getAllByRole('listitem');

    expect(within(items[0]).getByRole('button', { name: /zidell\/ginote/ }).getAttribute('aria-expanded')).toBe('true');

    await fireEvent.click(within(items[1]).getByRole('button', { name: /zidell\/other-project/ }));

    expect(within(items[0]).getByRole('button', { name: /zidell\/ginote/ }).getAttribute('aria-expanded')).toBe('false');
    expect(within(items[1]).getByRole('button', { name: /zidell\/other-project/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('목록 하단의 워크스페이스 추가 버튼을 누르면 onAddWorkspace를 호출한다', async () => {
    const onAddWorkspace = vi.fn();
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'a', onAddWorkspace });

    await fireEvent.click(screen.getByRole('button', { name: 'Add another repository' }));
    expect(onAddWorkspace).toHaveBeenCalled();
  });

  it('displayName이 있으면 저장소 주소 대신 표시명을 보여준다', () => {
    const items = [{ id: 'a', repo: 'zidell/ginote', displayName: '개인 노트' }];
    render(WorkspaceList, { workspaces: items, activeWorkspaceId: 'a' });

    expect(screen.getByText('개인 노트')).toBeTruthy();
    expect(screen.queryByText('zidell/ginote')).toBeNull();
  });

  it('더보기 드롭다운의 표시명 변경 항목을 누르면 현재 표시명이 채워진 입력창이 나타난다', async () => {
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'a' });
    const items = screen.getAllByRole('listitem');

    await fireEvent.click(within(items[0]).getByRole('button', { name: 'More actions' }));
    await fireEvent.click(within(items[0]).getByRole('button', { name: 'Rename' }));

    const input = within(items[0]).getByRole('textbox', { name: /Display name for/ });
    expect(input.value).toBe('zidell/ginote');
  });

  it('입력창에서 이름을 바꾸고 포커스를 벗어나면 onRename을 호출하고 입력창이 닫힌다', async () => {
    const onRename = vi.fn();
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'a', onRename });
    const items = screen.getAllByRole('listitem');

    await fireEvent.click(within(items[0]).getByRole('button', { name: 'More actions' }));
    await fireEvent.click(within(items[0]).getByRole('button', { name: 'Rename' }));
    const input = within(items[0]).getByRole('textbox', { name: /Display name for/ });
    await fireEvent.input(input, { target: { value: '개인 노트' } });
    await fireEvent.blur(input);

    expect(onRename).toHaveBeenCalledWith('a', '개인 노트');
    // 이 컴포넌트는 표시만 담당하므로(TagSettings와 동일한 패턴), 실제 반영은
    // 부모가 onRename 결과로 workspaces prop을 갱신해줘야 이뤄진다. 여기서는
    // 입력창이 닫혔는지만 확인한다.
    expect(within(items[0]).queryByRole('textbox', { name: /Display name for/ })).toBeNull();
  });

  it('Escape를 누르면 변경 없이 취소된다', async () => {
    const onRename = vi.fn();
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'a', onRename });
    const items = screen.getAllByRole('listitem');

    await fireEvent.click(within(items[0]).getByRole('button', { name: 'More actions' }));
    await fireEvent.click(within(items[0]).getByRole('button', { name: 'Rename' }));
    const input = within(items[0]).getByRole('textbox', { name: /Display name for/ });
    await fireEvent.input(input, { target: { value: '취소될 이름' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    await fireEvent.blur(input);

    expect(onRename).not.toHaveBeenCalled();
    expect(within(items[0]).getByText('zidell/ginote')).toBeTruthy();
  });

  it('빈 값으로 저장하면 onRename을 호출하지 않고 기존 이름을 유지한다', async () => {
    const onRename = vi.fn();
    render(WorkspaceList, { workspaces: workspaces(), activeWorkspaceId: 'a', onRename });
    const items = screen.getAllByRole('listitem');

    await fireEvent.click(within(items[0]).getByRole('button', { name: 'More actions' }));
    await fireEvent.click(within(items[0]).getByRole('button', { name: 'Rename' }));
    const input = within(items[0]).getByRole('textbox', { name: /Display name for/ });
    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.blur(input);

    expect(onRename).not.toHaveBeenCalled();
    expect(within(items[0]).getByText('zidell/ginote')).toBeTruthy();
  });
});
