import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SheetView from './SheetView.svelte';

function stubMatchMedia(matching) {
  vi.stubGlobal('matchMedia', vi.fn((query) => ({ matches: matching.includes(query), addEventListener() {}, removeEventListener() {} })));
}

describe('설정·도움말 화면 틀', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('헤더에 제목과 왼쪽 위 닫기 버튼을 두고 대화상자로 알린다', () => {
    stubMatchMedia([]);
    render(SheetView, { title: '설정', closeLabel: '설정 닫기' });
    expect(screen.getByRole('dialog', { name: '설정' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '설정 닫기' })).toBeTruthy();
  });

  it('태블릿 이상에서는 닫기 버튼과 바깥 영역 클릭으로 바로 닫는다', async () => {
    stubMatchMedia([]);
    const onClose = vi.fn();
    render(SheetView, { title: '설정', closeLabel: '설정 닫기', onClose });
    await fireEvent.click(screen.getByRole('button', { name: '설정 닫기' }));
    await fireEvent.click(document.querySelector('.sheet-overlay'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('휴대폰에서는 오른쪽으로 밀려 나간 뒤 닫는다', async () => {
    stubMatchMedia(['(max-width: 767.98px)']);
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(SheetView, { title: '설정', closeLabel: '설정 닫기', onClose });
    await fireEvent.click(screen.getByRole('button', { name: '설정 닫기' }));
    expect(document.querySelector('.sheet-overlay').classList.contains('is-leaving')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('휴대폰이라도 동작 줄이기 설정이면 바로 닫는다', async () => {
    stubMatchMedia(['(max-width: 767.98px)', '(prefers-reduced-motion: reduce)']);
    const onClose = vi.fn();
    render(SheetView, { title: '설정', closeLabel: '설정 닫기', onClose });
    await fireEvent.click(screen.getByRole('button', { name: '설정 닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
