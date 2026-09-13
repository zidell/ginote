import DOMPurify from 'dompurify';
import { marked } from 'marked';

const markdownOptions = {
  gfm: true,
  breaks: true
};

export function renderMarkdown(value) {
  const source = String(value || '');
  if (!source.trim()) return '';

  const rendered = marked.parse(source, markdownOptions);
  const sanitized = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    FORBID_ATTR: ['style'],
    ADD_TAGS: ['audio', 'source'],
    ADD_ATTR: ['controls', 'preload', 'src', 'type']
  });

  // DOMPurify removes unsafe protocols and attributes. Add the same external-link
  // behavior as the rest of the app after sanitizing the resulting fragment.
  if (typeof document === 'undefined') return sanitized;
  const template = document.createElement('template');
  template.innerHTML = sanitized;
  template.content.querySelectorAll('a').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noreferrer';
  });
  template.content.querySelectorAll('img').forEach((image) => {
    image.loading = 'lazy';
    image.decoding = 'async';
  });
  return template.innerHTML;
}
