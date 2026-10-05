// 맥 네이티브 앱 아이콘(Ginote/Resources/Assets.xcassets/AppIcon.appiconset)을 만든다.
//
// 원본은 Tauri와 같은 두 장(src-tauri/icons/source/background.svg, foreground.svg)이다. macOS 아이콘
// 규격(1024 캔버스에 824 둥근판을 가운데, 둘레 100의 여백과 옅은 그림자)에 맞춰, Dock·Finder에서 다른 앱과
// 같은 크기로 보이게 한다. 꽉 찬 그림을 그대로 쓰면 다른 앱보다 커 보인다.
//
// 틀은 Tauri의 macOS 아이콘과 같은 scripts/mac-icon-svg.mjs를 쓴다.
// 실행: node macos/scripts/app-icon.mjs  (SVG 그리기는 `tauri icon`을 쓴다)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { macIconSvg } from '../../scripts/mac-icon-svg.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = join(ROOT, 'src-tauri/icons/source');
const OUT = join(ROOT, 'macos/Ginote/Resources/Assets.xcassets/AppIcon.appiconset');

const inner = (file) => readFileSync(join(SOURCE, file), 'utf8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
const icon = macIconSvg(`${inner('background.svg')}\n${inner('foreground.svg')}`);

const files = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024]
];

const work = mkdtempSync(join(tmpdir(), 'ginote-mac-icon-'));
try {
  writeFileSync(join(work, 'icon.svg'), icon);
  const sizes = [...new Set(files.map(([, size]) => size))].join(',');
  execFileSync('npx', ['tauri', 'icon', join(work, 'icon.svg'), '-o', join(work, 'png'), '--png', sizes], { cwd: ROOT, stdio: 'inherit' });
  for (const [name, size] of files) copyFileSync(join(work, 'png', `${size}x${size}.png`), join(OUT, name));
} finally {
  rmSync(work, { recursive: true, force: true });
}
