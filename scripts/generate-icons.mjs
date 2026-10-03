// 앱 아이콘을 원본 두 장(src-tauri/icons/source/background.svg, foreground.svg)으로 모두 만든다.
//
// - 모바일(iOS·Android)과 PWA maskable: 꽉 찬 정사각형. 둥근 모서리는 각 OS가 마스크로 만든다.
//   iOS는 투명한 부분을 허용하지 않고, Android 적응형 아이콘은 전경·배경을 따로 받는다.
// - 데스크톱(macOS·Windows·Linux)·웹(public/icon.svg, 파비콘, PWA any): 같은 그림에 둥근 모서리를 씌운다.
//
// `tauri icon`은 src-tauri/gen/android·gen/apple이 있으면 그 프로젝트 아이콘까지 직접 갱신한다.
// 실행: npm run icons
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src-tauri/icons/source');
const ICONS = join(ROOT, 'src-tauri/icons');
const PUBLIC = join(ROOT, 'public');
const RADIUS = 112; // 512 기준. 기존 웹·데스크톱 아이콘과 같은 모서리.
// Android 적응형 아이콘은 캔버스의 가운데 66%만 원형·물방울 마스크로 보인다. 전경을 이 비율로 줄여
// 세로로 긴 노트의 대각선까지 그 안에 들어오게 한다.
const ANDROID_FG_SCALE = 0.68;

const inner = (file) => readFileSync(join(SOURCE, file), 'utf8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
const svg = (body, label = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"${label ? ` role="img" aria-label="${label}"` : ''}>\n${body}\n</svg>\n`;
const art = `${inner('background.svg')}\n${inner('foreground.svg')}`;
const square = svg(art);
const rounded = svg(`<defs><clipPath id="corner"><rect width="512" height="512" rx="${RADIUS}"/></clipPath></defs>\n<g clip-path="url(#corner)">\n${art}\n</g>`, 'Ginote');

const work = mkdtempSync(join(tmpdir(), 'ginote-icons-'));
const tauriIcon = (...args) => execFileSync('npx', ['tauri', 'icon', ...args], { cwd: ROOT, stdio: 'inherit' });
try {
  writeFileSync(join(work, 'square.svg'), square);
  writeFileSync(join(work, 'rounded.svg'), rounded);
  writeFileSync(join(work, 'android-fg.svg'), svg(`<g transform="translate(256 256) scale(${ANDROID_FG_SCALE}) translate(-256 -256)">\n${inner('foreground.svg')}\n</g>`));
  writeFileSync(join(work, 'manifest.json'), JSON.stringify({
    default: 'square.svg',
    android_bg: join(SOURCE, 'background.svg'),
    android_fg: 'android-fg.svg'
  }));

  // 1) 모바일 프로젝트 아이콘(꽉 찬 정사각형, Android는 전경·배경 분리)과 기본 데스크톱 아이콘
  tauriIcon(join(work, 'manifest.json'));

  // 2) 데스크톱 아이콘은 둥근판으로 덮는다(맨 위 폴더의 png·icns·ico만).
  const desktop = join(work, 'desktop');
  tauriIcon(join(work, 'rounded.svg'), '-o', desktop);
  for (const name of readdirSync(desktop)) {
    if (statSync(join(desktop, name)).isFile()) copyFileSync(join(desktop, name), join(ICONS, name));
  }

  // 3) 웹: 둥근 SVG·파비콘·PWA any, 정사각형 apple-touch-icon(iOS가 둥글게 깎음)·PWA maskable
  writeFileSync(join(PUBLIC, 'icon.svg'), rounded);
  tauriIcon(join(work, 'rounded.svg'), '-o', join(work, 'web-rounded'), '--png', '192,512');
  tauriIcon(join(work, 'square.svg'), '-o', join(work, 'web-square'), '--png', '180,512');
  copyFileSync(join(work, 'web-rounded/192x192.png'), join(PUBLIC, 'icon-192.png'));
  copyFileSync(join(work, 'web-rounded/512x512.png'), join(PUBLIC, 'icon-512.png'));
  copyFileSync(join(work, 'web-square/180x180.png'), join(PUBLIC, 'apple-touch-icon.png'));
  copyFileSync(join(work, 'web-square/512x512.png'), join(PUBLIC, 'icon-maskable-512.png'));
} finally {
  rmSync(work, { recursive: true, force: true });
}
