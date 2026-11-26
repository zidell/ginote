import { describe, expect, it, vi } from 'vitest';
import { appZoomAction, createAppZoom, normalizeAppScale } from './app-zoom.js';

describe('설치형 앱 확대', () => {
  it.each(['ctrlKey', 'metaKey'])('확대·축소·복원 키를 판별한다 (%s)', (modifier) => {
    const action = (key, options = {}) => appZoomAction({ key, [modifier]: true, ...options });
    expect(action('+', { shiftKey: true })).toBe('in');
    expect(action('=')).toBe('in');
    expect(action('-')).toBe('out');
    expect(action('0')).toBe('reset');
    expect(action('Add', { code: 'NumpadAdd' })).toBe('in');
    expect(action('Subtract', { code: 'NumpadSubtract' })).toBe('out');
    expect(action('+', { altKey: true })).toBeNull();
    expect(action('=', { isComposing: true })).toBeNull();
    expect(action(')', { shiftKey: true, code: 'Digit0' })).toBeNull();
    expect(action('_', { shiftKey: true, code: 'Minus' })).toBeNull();
    expect(appZoomAction({ key: '+', ctrlKey: true, metaKey: true })).toBeNull();
    expect(appZoomAction({ key: '+' })).toBeNull();
  });

  it('배율을 안전한 범위로 제한한다', () => {
    expect(normalizeAppScale(undefined)).toBe(1);
    expect(normalizeAppScale(NaN)).toBe(1);
    expect(normalizeAppScale(0)).toBe(0.5);
    expect(normalizeAppScale(10)).toBe(2);
    expect(normalizeAppScale(1.2000000000000002)).toBe(1.2);
  });

  it('입력칸에서도 연속 입력을 순서대로 적용하고 성공한 배율을 저장한다', async () => {
    const target = new EventTarget();
    const setZoom = vi.fn().mockResolvedValue(undefined);
    let scale = 1.2;
    const zoom = createAppZoom({ target, enabled: true, getScale: () => scale, onChange: (next) => { scale = next; }, setZoom });
    await zoom.sync(scale);
    const press = (key) => {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    };
    press('=');
    press('+');
    press('-');
    await vi.waitFor(() => expect(scale).toBe(1.3));
    expect(setZoom.mock.calls).toEqual([[1.2], [1.3], [1.4], [1.3]]);
    press('0');
    await vi.waitFor(() => expect(scale).toBe(1));
    zoom.destroy();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: '+', ctrlKey: true }));
    await Promise.resolve();
    expect(scale).toBe(1);
  });

  it('실패한 배율은 저장하지 않고 다음 입력에서 다시 시도한다', async () => {
    const target = new EventTarget();
    const setZoom = vi.fn().mockRejectedValueOnce(new Error('zoom failed')).mockResolvedValue(undefined);
    const onError = vi.fn();
    const onChange = vi.fn();
    const zoom = createAppZoom({ target, enabled: true, getScale: () => 1, onChange, onError, setZoom });
    target.dispatchEvent(new KeyboardEvent('keydown', { key: '+', ctrlKey: true }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onChange).not.toHaveBeenCalled();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: '+', ctrlKey: true }));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(1.1));
    zoom.destroy();
  });

  it('브라우저·모바일의 기본 확대를 가로채지 않는다', async () => {
    const target = new EventTarget();
    const setZoom = vi.fn();
    const zoom = createAppZoom({ target, enabled: false, getScale: () => 1, onChange: vi.fn(), setZoom });
    const event = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, cancelable: true });
    target.dispatchEvent(event);
    await zoom.sync(1.5);
    expect(event.defaultPrevented).toBe(false);
    expect(setZoom).not.toHaveBeenCalled();
    zoom.destroy();
  });
});
