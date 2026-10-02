// 목록 행을 길게 눌러 선택을 시작한다. 손가락이 움직이면 취소하고,
// 길게 누른 직후 브라우저가 이어서 보내는 click·contextmenu는 한 번 무시할 수 있게 표시해 둔다.
export function createLongPress({ delayMs = 500, moveTolerancePx = 10, suppressMs = 1000, onLongPress }) {
  let timer = null;
  let start = null;
  let suppressedId = null;
  let suppressTimer = null;

  function cancel() {
    clearTimeout(timer);
    timer = null;
    start = null;
  }

  function clearSuppression() {
    suppressedId = null;
    clearTimeout(suppressTimer);
  }

  return {
    begin(event, item) {
      cancel();
      start = { pointerId: event.pointerId, itemId: item.id, x: event.clientX, y: event.clientY };
      timer = setTimeout(() => {
        if (start?.itemId !== item.id) return;
        suppressedId = item.id;
        clearTimeout(suppressTimer);
        suppressTimer = setTimeout(() => { suppressedId = null; }, suppressMs);
        onLongPress(item);
      }, delayMs);
    },

    track(event) {
      if (!start || event.pointerId !== start.pointerId) return;
      if (
        Math.abs(event.clientX - start.x) > moveTolerancePx
        || Math.abs(event.clientY - start.y) > moveTolerancePx
      ) cancel();
    },

    finish(event) {
      if (start?.pointerId === event.pointerId) cancel();
    },

    cancel,
    clearSuppression,

    isSuppressed(item) {
      return suppressedId === item.id;
    },

    // 길게 누른 뒤 따라오는 click 한 번을 소비한다. 소비했으면 true다.
    consumeClick(item) {
      if (suppressedId !== item.id) return false;
      clearSuppression();
      return true;
    },

    destroy() {
      cancel();
      clearSuppression();
    }
  };
}
