import { describe, expect, it } from 'vitest';
import {
  arrowDirection,
  hasNoModifier,
  isDeleteShortcut,
  isEditableElement,
  isFormControl,
  isNewNoteShortcut,
  isNoteRowButton,
  isShiftOnly,
  isTextControl,
  workspaceNumberFromEvent
} from './keyboard-shortcuts.js';

function keyEvent(key, options = {}) {
  return new KeyboardEvent('keydown', { key, ...options });
}

function element(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container.firstElementChild;
}

describe('수정 키 판별', () => {
  it('수정 키가 하나라도 눌리면 단독 키가 아니다', () => {
    expect(hasNoModifier(keyEvent('n'))).toBe(true);
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      expect(hasNoModifier(keyEvent('n', { [modifier]: true }))).toBe(false);
    }
  });

  it('Shift만 눌렸을 때를 구분한다', () => {
    expect(isShiftOnly(keyEvent('ArrowDown', { shiftKey: true }))).toBe(true);
    expect(isShiftOnly(keyEvent('ArrowDown', { shiftKey: true, metaKey: true }))).toBe(false);
    expect(isShiftOnly(keyEvent('ArrowDown'))).toBe(false);
  });

  it('위아래 화살표를 방향으로 바꾼다', () => {
    expect(arrowDirection(keyEvent('ArrowDown'))).toBe(1);
    expect(arrowDirection(keyEvent('ArrowUp'))).toBe(-1);
    expect(arrowDirection(keyEvent('ArrowLeft'))).toBe(0);
  });
});

describe('단축키 판별', () => {
  it('숫자 키와 숫자 패드로 저장소 번호를 읽는다', () => {
    expect(workspaceNumberFromEvent(keyEvent('3'))).toBe(3);
    expect(workspaceNumberFromEvent(keyEvent('#', { code: 'Digit3' }))).toBe(3);
    expect(workspaceNumberFromEvent(keyEvent('End', { code: 'Numpad1' }))).toBe(1);
    expect(workspaceNumberFromEvent(keyEvent('0', { code: 'Digit0' }))).toBe(0);
    expect(workspaceNumberFromEvent(keyEvent('a', { code: 'KeyA' }))).toBe(0);
  });

  it('Delete와 Backspace를 키나 물리 키 위치로 알아본다', () => {
    expect(isDeleteShortcut(keyEvent('Delete'))).toBe(true);
    expect(isDeleteShortcut(keyEvent('Backspace'))).toBe(true);
    expect(isDeleteShortcut(keyEvent('Unidentified', { code: 'Backspace' }))).toBe(true);
    expect(isDeleteShortcut(keyEvent('d'))).toBe(false);
  });

  it('한글 입력 상태에서도 N 키 위치로 새 노트 단축키를 알아본다', () => {
    expect(isNewNoteShortcut(keyEvent('N'))).toBe(true);
    expect(isNewNoteShortcut(keyEvent('ㅜ', { code: 'KeyN' }))).toBe(true);
    expect(isNewNoteShortcut(keyEvent('m', { code: 'KeyM' }))).toBe(false);
  });
});

describe('포커스 요소 판별', () => {
  it('폼 컨트롤에는 select도 포함한다', () => {
    expect(isFormControl(element('<input>'))).toBe(true);
    expect(isFormControl(element('<textarea></textarea>'))).toBe(true);
    expect(isFormControl(element('<select></select>'))).toBe(true);
    expect(isFormControl(element('<button></button>'))).toBe(false);
    expect(isFormControl(null)).toBe(false);
  });

  it('붙여넣기를 맡길 입력 요소에는 select를 넣지 않는다', () => {
    expect(isEditableElement(element('<input>'))).toBe(true);
    expect(isEditableElement(element('<select></select>'))).toBe(false);
    expect(isEditableElement({ isContentEditable: true })).toBe(true);
  });

  it('가상 키보드를 띄우는 글 입력만 텍스트 컨트롤로 본다', () => {
    expect(isTextControl(element('<input>'))).toBe(true);
    expect(isTextControl(element('<input type="search">'))).toBe(true);
    expect(isTextControl(element('<input type="checkbox">'))).toBe(false);
    expect(isTextControl(element('<div contenteditable="true"></div>'))).toBe(true);
    expect(isTextControl(null)).toBe(false);
  });

  it('목록 행 버튼을 알아본다', () => {
    expect(isNoteRowButton(element('<button class="note-row-hit-area"></button>'))).toBe(true);
    expect(isNoteRowButton(element('<button></button>'))).toBe(false);
    expect(isNoteRowButton(document)).toBe(false);
  });
});
