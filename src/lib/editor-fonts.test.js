import { describe, expect, it } from 'vitest';
import { editorFontStack, localFontFamily, localFontValue } from './editor-fonts.js';

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
