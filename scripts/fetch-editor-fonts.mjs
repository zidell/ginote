// 에디터 웹폰트를 public/fonts/ 로 내려받아 self-host 한다.
//
// 외부 CDN(Google Fonts, jsDelivr, naver.github.io)에서 폰트를 직접 불러오면
// 사용자의 IP가 그 CDN들로 새어 나가고, CSP의 font-src/style-src도 열어둬야 한다.
// 이 스크립트로 받아둔 파일만 쓰면 font-src 'self' 만으로 충분해진다.
//
// 실행: node scripts/fetch-editor-fonts.mjs
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'fonts');

// Google Fonts는 요청한 브라우저에 맞는 포맷을 돌려준다. woff2를 받기 위해 최신 크롬으로 위장한다.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Google Fonts에서 받는 폰트. 폰트 파일을 함께 배포하려면 라이선스 사본도 같이 담아야
// 하므로(OFL 1.1의 조건) licenseUrl에서 원문을 받아 폰트 옆에 둔다.
const GOOGLE_FONTS = [
  { id: 'nanum-gothic-coding', family: 'Nanum Gothic Coding', license: 'OFL-1.1', licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothiccoding/OFL.txt' },
  { id: 'jetbrains-mono', family: 'JetBrains Mono', license: 'OFL-1.1', licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt' },
  { id: 'fira-code', family: 'Fira Code', license: 'OFL-1.1', licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/firacode/OFL.txt' },
  { id: 'source-code-pro', family: 'Source Code Pro', license: 'OFL-1.1', licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourcecodepro/OFL.txt' },
  { id: 'ibm-plex-mono', family: 'IBM Plex Mono', license: 'OFL-1.1', licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/OFL.txt' },
  { id: 'roboto-mono', family: 'Roboto Mono', license: 'OFL-1.1', licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/robotomono/OFL.txt' },
  { id: 'noto-sans-mono', family: 'Noto Sans Mono', license: 'OFL-1.1', licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansmono/OFL.txt' }
];

// Google Fonts 밖에서 받는 폰트.
const DIRECT_FONTS = [
  {
    id: 'd2-coding',
    family: 'D2Coding',
    license: 'OFL-1.1',
    licenseUrl: 'https://raw.githubusercontent.com/naver/d2-coding-font/master/OFL.txt',
    source: 'https://github.com/naver/d2-coding-font',
    faces: [
      { weight: 400, url: 'https://naver.github.io/d2-coding-font/fonts/D2Coding-Regular.woff2', file: 'D2Coding-Regular.woff2' },
      { weight: 700, url: 'https://naver.github.io/d2-coding-font/fonts/D2Coding-Bold.woff2', file: 'D2Coding-Bold.woff2' }
    ]
  },
  {
    id: 'inconsolata-g',
    family: 'Inconsolata-g',
    license: 'OFL-1.1',
    licenseUrl: 'https://raw.githubusercontent.com/powerline/fonts/master/Inconsolata-g/LICENSE.txt',
    source: 'https://github.com/powerline/fonts',
    faces: [
      {
        weight: 400,
        url: 'https://cdn.jsdelivr.net/gh/powerline/fonts@43ea1c81581daacadc5c1608eef7a0aae2105f2c/Inconsolata-g/Inconsolata-g%20for%20Powerline.otf',
        file: 'Inconsolata-g.otf',
        format: 'opentype'
      }
    ]
  }
];

async function fetchOk(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${url}`);
  return response;
}

async function saveLicense(dir, font) {
  const text = await (await fetchOk(font.licenseUrl, { headers: { 'user-agent': UA } })).text();
  await writeFile(join(dir, 'LICENSE.txt'), `${font.family} — ${font.license}\nOriginal: ${font.licenseUrl}\n\n${text}`);
}

async function saveBinary(path, url) {
  const response = await fetchOk(url, { headers: { 'user-agent': UA } });
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path, bytes);
  return bytes.length;
}

// Google Fonts의 CSS는 서브셋마다 @font-face 하나씩을 담고 gstatic URL을 가리킨다.
// 그 URL들을 모두 내려받고, CSS 안의 주소를 같은 폴더의 상대 경로로 바꾼다.
async function fetchGoogleFont(font) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}:wght@400;700&display=swap`;
  const css = await (await fetchOk(url, { headers: { 'user-agent': UA } })).text();
  const dir = join(OUT_DIR, font.id);
  await mkdir(dir, { recursive: true });

  const seen = new Map();
  const remoteUrls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];

  let bytes = 0;
  for (const remote of remoteUrls) {
    const name = `${font.id}-${seen.size.toString().padStart(3, '0')}.woff2`;
    seen.set(remote, name);
    bytes += await saveBinary(join(dir, name), remote);
  }

  const localCss = css.replace(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g, (match, remote) => (
    seen.has(remote) ? `url(${seen.get(remote)})` : match
  ));

  await writeFile(join(dir, 'font.css'), `/* ${font.family} — ${font.license}. Fetched from Google Fonts by scripts/fetch-editor-fonts.mjs. See LICENSE.txt. */\n${localCss}`);
  await saveLicense(dir, font);
  return { id: font.id, files: remoteUrls.length, bytes, family: font.family, license: font.license, source: 'https://fonts.google.com/' };
}

async function fetchDirectFont(font) {
  const dir = join(OUT_DIR, font.id);
  await mkdir(dir, { recursive: true });

  let bytes = 0;
  const faces = [];
  for (const face of font.faces) {
    bytes += await saveBinary(join(dir, face.file), face.url);
    faces.push(`@font-face {
  font-family: '${font.family}';
  font-style: normal;
  font-weight: ${face.weight};
  font-display: swap;
  src: url(${face.file}) format('${face.format || 'woff2'}');
}`);
  }

  await writeFile(join(dir, 'font.css'), `/* ${font.family} — ${font.license}. Fetched by scripts/fetch-editor-fonts.mjs. See LICENSE.txt. */\n${faces.join('\n')}\n`);
  await saveLicense(dir, font);
  return { id: font.id, files: font.faces.length, bytes, family: font.family, license: font.license, source: font.source };
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const results = [];
for (const font of GOOGLE_FONTS) results.push(await fetchGoogleFont(font));
for (const font of DIRECT_FONTS) results.push(await fetchDirectFont(font));

const summary = ['# Editor fonts', '',
  'These fonts ship with the app instead of being loaded from a CDN, so that using Ginote',
  'sends no request to any third party. Regenerate them with `node scripts/fetch-editor-fonts.mjs`.',
  '', '| Font | License | Source |', '| --- | --- | --- |',
  ...results.map((result) => `| ${result.family} | [${result.license}](${result.id}/LICENSE.txt) | ${result.source} |`),
  ''].join('\n');
await writeFile(join(OUT_DIR, 'README.md'), summary);

let total = 0;
for (const result of results) {
  total += result.bytes;
  console.log(`${result.id.padEnd(22)} ${String(result.files).padStart(3)} files  ${mb(result.bytes).padStart(9)}`);
}
console.log(`${'TOTAL'.padEnd(22)} ${String(results.reduce((sum, r) => sum + r.files, 0)).padStart(3)} files  ${mb(total).padStart(9)}`);
