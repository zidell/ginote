import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToast } from './toast.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('toast', () => {
  it('알림을 보여 주고 정해진 시간 뒤 지운다', () => {
    const toast = createToast(2400);
    toast.show('저장했습니다');
    expect(get(toast)).toBe('저장했습니다');
    vi.advanceTimersByTime(2399);
    expect(get(toast)).toBe('저장했습니다');
    vi.advanceTimersByTime(1);
    expect(get(toast)).toBe('');
  });

  it('새 알림은 이전 알림을 대신하고 시간을 다시 센다', () => {
    const toast = createToast(2400);
    toast.show('첫 알림');
    vi.advanceTimersByTime(2000);
    toast.show('둘째 알림');
    vi.advanceTimersByTime(2000);
    expect(get(toast)).toBe('둘째 알림');
    vi.advanceTimersByTime(400);
    expect(get(toast)).toBe('');
  });

  it('정리하면 예약된 지우기를 멈춘다', () => {
    const toast = createToast(2400);
    toast.show('알림');
    toast.destroy();
    vi.advanceTimersByTime(5000);
    expect(get(toast)).toBe('알림');
  });
});
