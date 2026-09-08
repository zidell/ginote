const LOCAL_FONT_PREFIX = 'local:';
const WEB_FONT_PREFIX = 'web:';
const MONO_FONT_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const webFontDefinitions = [
  {
    value: `${WEB_FONT_PREFIX}inconsolata-g`,
    label: 'Inconsolata-g',
    family: 'Inconsolata-g',
    cssText: `
      @font-face {
        font-family: 'Inconsolata-g';
        font-style: normal;
        font-weight: 400;
        font-display: swap;
        src: url('https://cdn.jsdelivr.net/gh/powerline/fonts@43ea1c81581daacadc5c1608eef7a0aae2105f2c/Inconsolata-g/Inconsolata-g%20for%20Powerline.otf') format('opentype');
      }
    `
  },
  {
    value: `${WEB_FONT_PREFIX}d2-coding`,
    label: 'D2Coding',
    family: 'D2Coding',
    cssText: `
      @font-face {
        font-family: 'D2Coding';
        font-style: normal;
        font-weight: 400;
        font-display: swap;
        src: url('https://naver.github.io/d2-coding-font/fonts/D2Coding-Regular.woff2') format('woff2');
      }
      @font-face {
        font-family: 'D2Coding';
        font-style: normal;
        font-weight: 700;
        font-display: swap;
        src: url('https://naver.github.io/d2-coding-font/fonts/D2Coding-Bold.woff2') format('woff2');
      }
    `
  },
  {
    value: `${WEB_FONT_PREFIX}nanum-gothic-coding`,
    label: 'Nanum Gothic Coding',
    family: 'Nanum Gothic Coding',
    stylesheet: 'https://fonts.googleapis.com/css2?family=Nanum+Gothic+Coding:wght@400;700&display=swap'
  },
  {
    value: `${WEB_FONT_PREFIX}jetbrains-mono`,
    label: 'JetBrains Mono',
    family: 'JetBrains Mono',
    stylesheet: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap'
  },
  {
    value: `${WEB_FONT_PREFIX}fira-code`,
    label: 'Fira Code',
    family: 'Fira Code',
    stylesheet: 'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap'
  },
  {
    value: `${WEB_FONT_PREFIX}source-code-pro`,
    label: 'Source Code Pro',
    family: 'Source Code Pro',
    stylesheet: 'https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;700&display=swap'
  },
  {
    value: `${WEB_FONT_PREFIX}ibm-plex-mono`,
    label: 'IBM Plex Mono',
    family: 'IBM Plex Mono',
    stylesheet: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&display=swap'
  },
  {
    value: `${WEB_FONT_PREFIX}roboto-mono`,
    label: 'Roboto Mono',
    family: 'Roboto Mono',
    stylesheet: 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap'
  },
  {
    value: `${WEB_FONT_PREFIX}noto-sans-mono`,
    label: 'Noto Sans Mono',
    family: 'Noto Sans Mono',
    stylesheet: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Mono:wght@400;700&display=swap'
  }
].map((font) => Object.freeze(font));

export const CODING_FONT_OPTIONS = Object.freeze(webFontDefinitions);
const webFontByValue = new Map(webFontDefinitions.map((font) => [font.value, font]));
const loadedWebFonts = new Set();
const pendingWebFontLoads = new Map();

export function localFontValue(family) {
  const name = String(family || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return name ? `${LOCAL_FONT_PREFIX}${name}` : '';
}

export function localFontFamily(value) {
  if (typeof value !== 'string' || !value.startsWith(LOCAL_FONT_PREFIX)) return '';
  return value.slice(LOCAL_FONT_PREFIX.length).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

export function webFontDefinition(value) {
  return webFontByValue.get(value) || null;
}

export function isWebFont(value) {
  return Boolean(webFontDefinition(value));
}

function quotedFontFamily(family) {
  return `"${String(family).replace(/["\\]/g, '\\$&')}"`;
}

async function waitForWebFont(font) {
  if (typeof document === 'undefined' || !document.fonts?.load) return true;

  await Promise.allSettled([
    document.fonts.load(`400 1em ${quotedFontFamily(font.family)}`),
    document.fonts.load(`700 1em ${quotedFontFamily(font.family)}`)
  ]);
  return true;
}

function existingWebFontElement(value) {
  return [...document.head.querySelectorAll('[data-ginote-web-font]')]
    .find((element) => element.dataset.ginoteWebFont === value);
}

export function loadWebFont(value) {
  const font = webFontDefinition(value);
  if (!font || typeof document === 'undefined' || !document.head) return Promise.resolve(false);
  if (loadedWebFonts.has(value)) return Promise.resolve(true);
  if (pendingWebFontLoads.has(value)) return pendingWebFontLoads.get(value);

  const promise = new Promise((resolve) => {
    const existing = existingWebFontElement(value);
    if (existing) {
      waitForWebFont(font).then(() => resolve(true));
      return;
    }

    if (font.stylesheet) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = font.stylesheet;
      link.crossOrigin = 'anonymous';
      link.dataset.ginoteWebFont = value;
      link.onload = () => waitForWebFont(font).then(() => resolve(true));
      link.onerror = () => {
        link.remove();
        resolve(false);
      };
      document.head.append(link);
      return;
    }

    const style = document.createElement('style');
    style.dataset.ginoteWebFont = value;
    style.textContent = font.cssText || '';
    document.head.append(style);
    waitForWebFont(font).then(() => resolve(true));
  }).then((loaded) => {
    pendingWebFontLoads.delete(value);
    if (loaded) loadedWebFonts.add(value);
    return loaded;
  });

  pendingWebFontLoads.set(value, promise);
  return promise;
}

export function editorFontStack(value) {
  const localFamily = localFontFamily(value);
  if (localFamily) return `"${localFamily.replace(/["\\]/g, '\\$&')}", sans-serif`;

  const webFont = webFontDefinition(value);
  if (webFont) return `${quotedFontFamily(webFont.family)}, ${MONO_FONT_FALLBACK}`;

  return {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Pretendard, sans-serif',
    sans: 'Pretendard, "Noto Sans KR", sans-serif',
    serif: '"Noto Serif KR", "Batang", serif',
    mono: MONO_FONT_FALLBACK
  }[value] || 'sans-serif';
}
