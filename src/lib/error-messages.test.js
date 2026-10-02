import { beforeAll, describe, expect, it } from 'vitest';
import { friendlyError } from './error-messages.js';
import { setAppLocale, translate } from './i18n.js';

beforeAll(() => setAppLocale('en'));

describe('friendlyError', () => {
  it('GitHub 응답 상태에 맞는 안내를 고른다', () => {
    expect(friendlyError({ status: 401 })).toBe(translate('m.faea518485'));
    expect(friendlyError({ status: 404 })).toBe(translate('m.ff34a34522'));
    expect(friendlyError({ status: 403, remaining: '0' })).toBe(translate('m.27ef201e27'));
    expect(friendlyError({ status: 403, remaining: '10' })).toBe(translate('m.26096781ad'));
  });

  it('그 밖에는 오류 메시지를, 메시지도 없으면 일반 안내를 쓴다', () => {
    expect(friendlyError(new Error('네트워크 끊김'))).toBe('네트워크 끊김');
    expect(friendlyError(null)).toBe(translate('m.285cc7fd9a'));
  });

  it('상태별 안내는 서로 다르다', () => {
    const messages = [401, 404, 403].map((status) => friendlyError({ status }));
    expect(new Set(messages).size).toBe(3);
  });
});
