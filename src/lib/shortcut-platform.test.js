import { describe, expect, it } from 'vitest';
import { shortcutModifierForPlatform } from './shortcut-platform.js';

describe('shortcutModifierForPlatform', () => {
  it('Safari에서는 Control을 표시한다', () => {
    expect(shortcutModifierForPlatform({
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
    })).toBe('⌃');
  });

  it('macOS Chrome에서는 Command를 표시한다', () => {
    expect(shortcutModifierForPlatform({
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'
    })).toBe('⌘');
  });

  it('Apple 기기가 아닌 환경에서는 Control을 표시한다', () => {
    expect(shortcutModifierForPlatform({ platform: 'Win32' })).toBe('⌃');
  });
});
