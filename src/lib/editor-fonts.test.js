import { describe, expect, it } from 'vitest';
import {
  CODING_FONT_OPTIONS,
  editorFontStack,
  isWebFont,
  loadWebFont,
  localFontFamily,
  localFontValue,
  webFontDefinition,
  webFontStylesheetHref
} from './editor-fonts.js';

describe('로컬 편집기 폰트', () => {
  it('시스템 폰트명을 저장 가능한 설정 값으로 만든다', () => {
    expect(localFontValue('Pretendard')).toBe('local:Pretendard');
    expect(localFontFamily('local:Pretendard')).toBe('Pretendard');
  });

  it('로컬 폰트명을 CSS 문자열로 안전하게 감싼다', () => {
    expect(editorFontStack('local:Font "Name"')).toBe('"Font \\"Name\\"", sans-serif');
  });

  it('알 수 없는 설정 값은 기본 sans-serif로 대체한다', () => {
    expect(editorFontStack('unknown')).toBe('sans-serif');
  });
});

describe('웹 코딩 폰트', () => {
  it('select 하단에 대표 코딩 폰트 선택지를 제공한다', () => {
    expect(CODING_FONT_OPTIONS).toHaveLength(9);
    expect(CODING_FONT_OPTIONS.map((font) => font.label)).toEqual([
      'Inconsolata-g',
      'D2Coding',
      'Nanum Gothic Coding',
      'JetBrains Mono',
      'Fira Code',
      'Source Code Pro',
      'IBM Plex Mono',
      'Roboto Mono',
      'Noto Sans Mono'
    ]);
  });

  it('웹폰트 설정값을 고정된 CSS 글꼴 스택으로 연결한다', () => {
    expect(isWebFont('web:inconsolata-g')).toBe(true);
    expect(webFontDefinition('web:inconsolata-g')?.family).toBe('Inconsolata-g');
    expect(editorFontStack('web:inconsolata-g')).toBe(
      '"Inconsolata-g", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    );
    expect(editorFontStack('web:d2-coding')).toContain('"D2Coding"');
    expect(isWebFont('web:unknown')).toBe(false);
  });

  it('Inconsolata-g를 선택하면 해당 스타일시트를 지연 로드한다', async () => {
    document.head.querySelector('[data-ginote-web-font="web:inconsolata-g"]')?.remove();

    const loading = loadWebFont('web:inconsolata-g');
    const link = document.head.querySelector('[data-ginote-web-font="web:inconsolata-g"]');

    expect(link?.tagName).toBe('LINK');
    expect(link?.getAttribute('href')).toContain('fonts/inconsolata-g/font.css');

    // jsdom은 스타일시트를 실제로 내려받지 않으므로 load 이벤트를 대신 발생시킨다.
    link.dispatchEvent(new Event('load'));
    expect(await loading).toBe(true);
  });

  // 폰트를 다시 외부 CDN으로 되돌리면 사용자 IP가 그 CDN으로 새어 나가고, 좁혀둔
  // font-src·style-src도 함께 열어야 한다. 그런 회귀를 여기서 막는다.
  it('모든 코딩 폰트를 외부 CDN이 아닌 같은 출처에서 불러온다', () => {
    for (const font of CODING_FONT_OPTIONS) {
      expect(webFontStylesheetHref(font)).toBe(`${document.baseURI.replace(/[^/]*$/, '')}fonts/${font.directory}/font.css`);
    }
  });
});
