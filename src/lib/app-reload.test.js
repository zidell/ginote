import { describe, expect, it, vi } from 'vitest';
import { reloadApp } from './app-reload.js';

describe('앱 새로고침', () => {
  it('모든 저장을 기다리고 중복 요청은 한 번만 새로고침한다', async () => {
    const target = new EventTarget();
    const reload = vi.fn();
    let finishSave;
    target.addEventListener('app-before-reload', (event) => {
      event.detail.saves.push(new Promise((resolve) => { finishSave = resolve; }));
    });
    const first = reloadApp({ target, reload });
    const second = reloadApp({ target, reload });
    expect(second).toBe(first);
    expect(reload).not.toHaveBeenCalled();
    finishSave(true);
    expect(await first).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([false, 'error'])('저장 실패 시 새로고침하지 않고 재시도할 수 있다 (%s)', async (result) => {
    const target = new EventTarget();
    const reload = vi.fn();
    target.addEventListener('app-before-reload', (event) => {
      event.detail.saves.push(result === 'error' ? Promise.reject(new Error('offline')) : false);
    }, { once: true });
    expect(await reloadApp({ target, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(await reloadApp({ target, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
