// 본문이 비어 제목을 정할 수 없을 때 쓰는 제목. GitHub는 빈 제목을 받지 않으므로 태그부터 붙여도 저장되게 한다.
// 본문이 들어오면 첫 줄로 바뀐다(별도 제목 모드에서도 이 제목이면 첫 줄로 바꾼다).
export const UNTITLED_TITLE = 'Untitled';

// 별도 제목 모드: 직접 쓴 제목이 없거나 Untitled면 본문 첫 줄, 그것도 없으면 Untitled.
export function separateModeTitle(title, body) {
  const typed = String(title || '').trim();
  if (typed && typed !== UNTITLED_TITLE) return typed;
  return automaticTitle(String(body || '').trim()) || UNTITLED_TITLE;
}

export function automaticTitle(value, maxLength = 50) {
  const text = String(value || '');
  const lineEnd = text.search(/\r?\n/);
  const firstLine = (lineEnd < 0 ? text : text.slice(0, lineEnd)).trim();
  return Array.from(firstLine).slice(0, maxLength).join('');
}

export function markdownToPlainText(value) {
  return String(value || '')
    .replace(/```[^\n]*\n?/g, '')
    .replace(/~~~[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\[([ xX])\]\s*/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*~_]/g, '')
    .replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function linkAtCursor(value, cursor) {
  const text = String(value || '');
  const position = Number(cursor);
  if (!Number.isInteger(position) || position < 0 || position > text.length) return null;

  const markdownLink = /(?<!!)\[[^\]\n]*\]\(\s*(https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/gi;
  for (const match of text.matchAll(markdownLink)) {
    const start = match.index;
    const end = start + match[0].length;
    if (position >= start && position <= end) {
      return { url: match[1], start, end };
    }
  }

  const plainLink = /https?:\/\/[^\s<>"'`]+/gi;
  for (const match of text.matchAll(plainLink)) {
    const url = match[0].replace(/[\].,;:!?)}]+$/, '');
    const start = match.index;
    const end = start + url.length;
    if (position >= start && position <= end) return { url, start, end };
  }

  return null;
}

export function shortenMiddle(value, maxLength = 64) {
  const characters = Array.from(String(value || ''));
  if (characters.length <= maxLength) return characters.join('');
  const available = Math.max(2, maxLength - 1);
  const leading = Math.ceil(available / 2);
  const trailing = Math.floor(available / 2);
  return `${characters.slice(0, leading).join('')}…${characters.slice(-trailing).join('')}`;
}

export function firstLinePreview(value, maxLength = 50) {
  const firstLine = String(value || '').split(/\r?\n/, 1)[0] || '';
  return Array.from(markdownToPlainText(firstLine)).slice(0, maxLength).join('');
}

export function normalizeTagName(value) {
  return Array.from(String(value ?? '').trim().replace(/^#+/, '').replace(/\s+/g, '-')).slice(0, 50).join('');
}
