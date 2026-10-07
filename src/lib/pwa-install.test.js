import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { dismissInstallBanner, installPrompt, isInstallBannerDismissed, mobilePlatform, promptInstall } from './pwa-install.js';

afterEach(() => {
  localStorage.clear();
  installPrompt.set(null);
});

describe('mobilePlatform', () => {
  it('Android와 iPhone·iPad를 구분하고 데스크톱은 비운다', () => {
    expect(mobilePlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile' })).toBe('android');
    expect(mobilePlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe('ios');
    expect(mobilePlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5 })).toBe('ios');
    expect(mobilePlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 0 })).toBe('');
    expect(mobilePlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0' })).toBe('');
  });
});

describe('설치 프롬프트', () => {
  it('브라우저가 미리 보낸 설치 이벤트를 보관했다가 한 번만 쓴다', async () => {
    const event = new Event('beforeinstallprompt');
    event.prompt = vi.fn().mockResolvedValue(undefined);
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
    expect(get(installPrompt)).toBe(event);

    expect(await promptInstall(get(installPrompt))).toBe(true);
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(get(installPrompt)).toBeNull();
  });

  it('배너를 닫으면 다음에도 닫힌 상태로 기억한다', () => {
    expect(isInstallBannerDismissed()).toBe(false);
    dismissInstallBanner();
    expect(isInstallBannerDismissed()).toBe(true);
  });
});
