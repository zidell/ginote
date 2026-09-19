import { isFormControl } from './keyboard-shortcuts.js';

const READY_CLASS = 'keyboard-shortcuts-ready';

// 키보드 단축키를 쓸 수 있을 때(터치 기기가 아니고 입력창에 포커스가 없을 때) body에 표시 클래스를 단다.
// 포커스 이벤트가 몰려도 한 프레임에 한 번만 다시 계산한다.
export function createKeyboardReadyClass(isTouchDevice) {
  let frame = 0;

  function sync() {
    frame = 0;
    document.body?.classList.toggle(READY_CLASS, !isTouchDevice() && !isFormControl(document.activeElement));
  }

  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(sync);
  }

  function clear() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    document.body?.classList.remove(READY_CLASS);
  }

  // 포커스 변화를 따라가기 시작한다. 돌려준 함수를 부르면 멈추고 클래스를 뗀다.
  function attach() {
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    window.addEventListener('focus', schedule);
    window.addEventListener('blur', clear);
    schedule();
    return () => {
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('blur', clear);
      clear();
    };
  }

  return { schedule, clear, attach };
}
