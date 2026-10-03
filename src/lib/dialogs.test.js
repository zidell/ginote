import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmAction } from './dialogs.js';

describe('확인창', () => {
  afterEach(() => vi.restoreAllMocks());

  it('웹에서는 브라우저 confirm 결과를 돌려준다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const nativeConfirm = vi.fn();
    expect(await confirmAction('삭제할까요?', { isTauri: false, nativeConfirm })).toBe(true);
    expect(window.confirm).toHaveBeenCalledWith('삭제할까요?');
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('앱에서는 브라우저 confirm 대신 네이티브 확인창을 띄운다', async () => {
    vi.spyOn(window, 'confirm');
    const nativeConfirm = vi.fn(async () => true);
    expect(await confirmAction('삭제할까요?', { isTauri: true, nativeConfirm })).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(nativeConfirm).toHaveBeenCalledWith('삭제할까요?', expect.objectContaining({ title: 'Ginote', kind: 'warning' }));
  });

  it('네이티브 확인창이 실패하면 진행하지 않는다', async () => {
    const nativeConfirm = vi.fn(async () => { throw new Error('no dialog'); });
    expect(await confirmAction('삭제할까요?', { isTauri: true, nativeConfirm })).toBe(false);
  });
});
