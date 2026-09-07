import { describe, expect, it } from 'vitest';
import { workspaceIdForShortcut } from './workspace-shortcut.js';

const workspaces = [{ id: 'first' }, { id: 'second' }];

describe('workspaceIdForShortcut', () => {
  it.each([
    [{ key: '1', ctrlKey: true }, 'first'],
    [{ key: '2', metaKey: true }, 'second']
  ])('Ctrl/Cmd + 숫자를 워크스페이스 순서에 매핑한다', (event, expected) => {
    expect(workspaceIdForShortcut(event, workspaces)).toBe(expected);
  });

  it.each([
    { key: '3', ctrlKey: true },
    { key: '1' },
    { key: '1', ctrlKey: true, shiftKey: true },
    { key: '1', ctrlKey: true, altKey: true },
    { key: '1', ctrlKey: true, repeat: true }
  ])('대상이 없거나 다른 조합이면 무시한다', (event) => {
    expect(workspaceIdForShortcut(event, workspaces)).toBe('');
  });
});
