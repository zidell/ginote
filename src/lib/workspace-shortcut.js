// 워크스페이스의 표시 순서(1부터 9까지)를 전역 단축키와 연결한다.
export function workspaceIdForShortcut(event, workspaces) {
  if (
    event.repeat
    || event.altKey
    || event.shiftKey
    || (!event.ctrlKey && !event.metaKey)
    || !/^[1-9]$/.test(event.key)
  ) return '';

  return workspaces[Number(event.key) - 1]?.id || '';
}
