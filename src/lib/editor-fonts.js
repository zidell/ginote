const LOCAL_FONT_PREFIX = 'local:';
const WEB_FONT_PREFIX = 'web:';
const MONO_FONT_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// 코딩 폰트는 모두 앱과 함께 배포하는 public/fonts/ 의 파일만 쓴다. 외부 CDN에서 불러오면
// 폰트를 고른 사용자의 IP가 그 CDN으로 새어 나가고, CSP의 font-src와 style-src도 그만큼
// 열어둬야 한다. 폰트 파일을 갱신하려면 scripts/fetch-editor-fonts.mjs 를 실행한다.
const webFontDefinitions = [
  { value: `${WEB_FONT_PREFIX}inconsolata-g`, label: 'Inconsolata-g', family: 'Inconsolata-g', directory: 'inconsolata-g' },
  { value: `${WEB_FONT_PREFIX}d2-coding`, label: 'D2Coding', family: 'D2Coding', directory: 'd2-coding' },
  { value: `${WEB_FONT_PREFIX}nanum-gothic-coding`, label: 'Nanum Gothic Coding', family: 'Nanum Gothic Coding', directory: 'nanum-gothic-coding' },
  { value: `${WEB_FONT_PREFIX}jetbrains-mono`, label: 'JetBrains Mono', family: 'JetBrains Mono', directory: 'jetbrains-mono' },
  { value: `${WEB_FONT_PREFIX}fira-code`, label: 'Fira Code', family: 'Fira Code', directory: 'fira-code' },
  { value: `${WEB_FONT_PREFIX}source-code-pro`, label: 'Source Code Pro', family: 'Source Code Pro', directory: 'source-code-pro' },
  { value: `${WEB_FONT_PREFIX}ibm-plex-mono`, label: 'IBM Plex Mono', family: 'IBM Plex Mono', directory: 'ibm-plex-mono' },
  { value: `${WEB_FONT_PREFIX}roboto-mono`, label: 'Roboto Mono', family: 'Roboto Mono', directory: 'roboto-mono' },
  { value: `${WEB_FONT_PREFIX}noto-sans-mono`, label: 'Noto Sans Mono', family: 'Noto Sans Mono', directory: 'noto-sans-mono' }
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

// 앱은 도메인 최상위가 아닌 하위 경로에도 배포될 수 있으므로 문서의 기준 주소로 푼다.
export function webFontStylesheetHref(font) {
  const path = `fonts/${font.directory}/font.css`;
  if (typeof document === 'undefined') return path;
  return new URL(path, document.baseURI).href;
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

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = webFontStylesheetHref(font);
    link.dataset.ginoteWebFont = value;
    link.onload = () => waitForWebFont(font).then(() => resolve(true));
    link.onerror = () => {
      link.remove();
      resolve(false);
    };
    document.head.append(link);
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
