import { describe, expect, it } from 'vitest';
import {
  CODING_FONT_OPTIONS,
  editorFontStack,
  isWebFont,
  loadWebFont,
  localFontFamily,
  localFontValue,
  webFontDefinition
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

  it('Inconsolata-g를 선택하면 해당 @font-face를 지연 등록한다', async () => {
    document.head.querySelector('[data-ginote-web-font="web:inconsolata-g"]')?.remove();

    expect(await loadWebFont('web:inconsolata-g')).toBe(true);

    const style = document.head.querySelector('[data-ginote-web-font="web:inconsolata-g"]');
    expect(style?.textContent).toContain("font-family: 'Inconsolata-g'");
    expect(style?.textContent).toContain('format(\'opentype\')');
  });
});
