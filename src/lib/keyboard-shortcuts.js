export function hasNoModifier(event) {
  return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

export function isShiftOnly(event) {
  return !event.altKey && !event.ctrlKey && !event.metaKey && event.shiftKey;
}

// ↓는 1, ↑는 -1, 그 밖의 키는 0이다.
export function arrowDirection(event) {
  if (event.key === 'ArrowDown') return 1;
  if (event.key === 'ArrowUp') return -1;
  return 0;
}

export function workspaceNumberFromEvent(event) {
  const keyMatch = /^[1-9]$/.exec(event.key);
  const codeMatch = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  return Number(keyMatch?.[0] || codeMatch?.[1] || 0);
}

export function isDeleteShortcut(event) {
  return ['Delete', 'Backspace'].includes(event.key)
    || ['Delete', 'Backspace'].includes(event.code);
}

export function isNewNoteShortcut(event) {
  // event.key는 현재 입력 소스를 반영하지만 event.code는 물리 키 위치를 유지한다.
  return event.key.toLocaleLowerCase() === 'n' || event.code === 'KeyN';
}

// 포커스가 여기에 있으면 목록 단축키를 쓰지 않는다.
export function isFormControl(element) {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || Boolean(element?.isContentEditable);
}

// 붙여넣기를 가로채지 않고 그대로 둘 입력 요소다.
export function isEditableElement(element) {
  return element instanceof HTMLTextAreaElement
    || element instanceof HTMLInputElement
    || Boolean(element?.isContentEditable);
}

// 가상 키보드를 띄우는 글 입력 요소다.
export function isTextControl(element) {
  return element instanceof HTMLElement
    && element.matches('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="password"], [contenteditable="true"]');
}

export function isNoteRowButton(element) {
  return element instanceof HTMLElement && element.classList.contains('note-row-hit-area');
}
