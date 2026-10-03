// 설치된 macOS·Linux 앱의 업데이터가 읽는 latest.json을 만든다(.github/workflows/release.yml).
// 릴리스에 올라간 업데이트 파일의 서명(*.sig)을 모아, 업데이터가 찾는 플랫폼 키에 연결한다.
// 사용: node scripts/updater-manifest.mjs <서명 폴더> <버전> <다운로드 주소 접두사> > latest.json
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 업데이터는 "<OS>-<아키텍처>-<설치 형식>"을 먼저 찾고, 없으면 "<OS>-<아키텍처>"를 쓴다
// (tauri-plugin-updater의 get_urls). macOS는 유니버설 앱 하나가 두 아키텍처를 맡는다.
const PLATFORM_KEYS = [
  [/\.app\.tar\.gz$/, ['darwin-aarch64', 'darwin-x86_64', 'darwin-aarch64-app', 'darwin-x86_64-app']],
  [/\.AppImage$/, ['linux-x86_64', 'linux-x86_64-appimage']],
  [/\.deb$/, ['linux-x86_64-deb']],
  [/\.rpm$/, ['linux-x86_64-rpm']]
];

export function buildUpdaterManifest({ signatures, version, baseUrl, notes = '', pubDate = new Date().toISOString() }) {
  const platforms = {};
  for (const [asset, signature] of Object.entries(signatures)) {
    const match = PLATFORM_KEYS.find(([pattern]) => pattern.test(asset));
    if (!match) continue;
    for (const key of match[1]) {
      if (platforms[key]) throw new Error(`Two update files claim ${key}: ${platforms[key].url} and ${asset}`);
      platforms[key] = { signature: signature.trim(), url: `${baseUrl}/${encodeURIComponent(asset)}` };
    }
  }
  for (const required of ['darwin-aarch64', 'linux-x86_64']) {
    if (!platforms[required]) throw new Error(`No signed update file for ${required}`);
  }
  return { version, notes, pub_date: pubDate, platforms };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [dir, version, baseUrl] = process.argv.slice(2);
  if (!dir || !version || !baseUrl) {
    console.error('usage: node scripts/updater-manifest.mjs <signature-dir> <version> <base-url>');
    process.exit(2);
  }
  const signatures = {};
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.sig')) signatures[file.slice(0, -4)] = readFileSync(join(dir, file), 'utf8');
  }
  const manifest = buildUpdaterManifest({ signatures, version, baseUrl, notes: `Ginote ${version}` });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
