const LOCAL_FONT_PREFIX = 'local:';

export function localFontValue(family) {
  const name = String(family || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return name ? `${LOCAL_FONT_PREFIX}${name}` : '';
}

export function localFontFamily(value) {
  if (typeof value !== 'string' || !value.startsWith(LOCAL_FONT_PREFIX)) return '';
  return value.slice(LOCAL_FONT_PREFIX.length).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

export function editorFontStack(value) {
  const localFamily = localFontFamily(value);
  if (localFamily) return `"${localFamily.replace(/["\\\\]/g, '\\$&')}", sans-serif`;

  return {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Pretendard, sans-serif',
    sans: 'Pretendard, "Noto Sans KR", sans-serif',
    serif: '"Noto Serif KR", "Batang", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  }[value] || 'sans-serif';
}
