import { describe, expect, it } from 'vitest';
import { normalizeLocale, setAppLocale, translate } from './i18n.js';

describe('i18n', () => {
  it('지원하는 브라우저 언어를 앱 locale로 정규화한다', () => {
    expect(normalizeLocale('ko-KR')).toBe('ko');
    expect(normalizeLocale('zh-TW')).toBe('zh-CN');
    expect(normalizeLocale('ja-JP')).toBe('ja');
    expect(normalizeLocale('de-DE')).toBe('de');
    expect(normalizeLocale('fr-FR')).toBe('fr');
    expect(normalizeLocale('it-IT')).toBe('it');
    expect(normalizeLocale('es-ES')).toBe('en');
  });

  it('locale 변경과 ICU 변수 치환을 지원한다', () => {
    setAppLocale('ko');
    expect(translate('dynamic.noteCount', { count: 12 })).toBe('12개');
    setAppLocale('en');
    expect(translate('dynamic.noteCount', { count: 12 })).toBe('12 notes');
  });

  it('모든 지원 언어에 설정 위저드 번역을 제공한다', () => {
    const expectedTitles = {
      en: 'Set up Ginote',
      ko: 'Ginote 설정',
      'zh-CN': '设置 Ginote',
      ja: 'Ginoteのセットアップ',
      de: 'Ginote einrichten',
      fr: 'Configurer Ginote',
      it: 'Configura Ginote'
    };

    for (const [locale, title] of Object.entries(expectedTitles)) {
      setAppLocale(locale);
      expect(translate('setup.wizardTitle')).toBe(title);
      if (locale !== 'en') {
        expect(translate('setup.accountDescription')).not.toMatch(/^You need a GitHub account/);
      }
    }
    setAppLocale('en');
  });
});
