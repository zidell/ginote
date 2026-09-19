import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLongPress } from './long-press.js';

const item = { id: 7 };
const other = { id: 8 };

function pointer(overrides = {}) {
  return { pointerId: 1, clientX: 100, clientY: 100, ...overrides };
}

let onLongPress;
let longPress;

beforeEach(() => {
  vi.useFakeTimers();
  onLongPress = vi.fn();
  longPress = createLongPress({ onLongPress });
});

afterEach(() => {
  longPress.destroy();
  vi.useRealTimers();
});

describe('long-press', () => {
  it('500ms 동안 누르고 있으면 길게 누르기로 본다', () => {
    longPress.begin(pointer(), item);
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledWith(item);
  });

  it('손을 떼거나 10px 넘게 움직이면 취소한다', () => {
    longPress.begin(pointer(), item);
    longPress.track(pointer({ clientX: 108, clientY: 92 }));
    longPress.track(pointer({ pointerId: 2, clientX: 500 }));
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    longPress.begin(pointer(), item);
    longPress.track(pointer({ clientY: 111 }));
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    longPress.begin(pointer(), item);
    longPress.finish(pointer({ pointerId: 2 }));
    longPress.finish(pointer());
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('길게 누른 직후의 클릭 한 번만 소비한다', () => {
    longPress.begin(pointer(), item);
    vi.advanceTimersByTime(500);

    expect(longPress.isSuppressed(item)).toBe(true);
    expect(longPress.consumeClick(other)).toBe(false);
    expect(longPress.consumeClick(item)).toBe(true);
    expect(longPress.consumeClick(item)).toBe(false);
  });

  it('클릭이 오지 않으면 1초 뒤 무시 표시를 푼다', () => {
    longPress.begin(pointer(), item);
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(1000);
    expect(longPress.isSuppressed(item)).toBe(false);
  });

  it('선택을 해제하면 무시 표시도 지운다', () => {
    longPress.begin(pointer(), item);
    vi.advanceTimersByTime(500);
    longPress.clearSuppression();
    expect(longPress.consumeClick(item)).toBe(false);
  });

  it('다른 행을 새로 누르면 이전 누르기는 잊는다', () => {
    longPress.begin(pointer(), item);
    vi.advanceTimersByTime(300);
    longPress.begin(pointer({ pointerId: 2 }), other);
    vi.advanceTimersByTime(500);
    expect(onLongPress.mock.calls).toEqual([[other]]);
  });
});
