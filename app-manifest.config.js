// 앱이 웹 빌드로 프론트엔드를 자동 교체할 때 읽는 매니페스트를 만든다(docs/APP_OTA.md).
// 형식은 src-tauri/src/ota.rs 와의 규약이므로, 바꿀 때는 두 쪽을 같은 커밋에서 고친다.
import { createHash, createPrivateKey, sign } from 'node:crypto';

export const MANIFEST_FORMAT = 1;
export const MANIFEST_FILE = 'app-manifest.json';
export const SIGNATURE_FILE = 'app-manifest.json.sig';

// 웹에서만 쓰는 파일은 앱에 내려보내지 않는다.
const WEB_ONLY = new Set(['_headers', 'sw.js', 'og-image.png', 'sitemap.xml', 'robots.txt', MANIFEST_FILE, SIGNATURE_FILE]);

export function isAppFile(path) {
  return !WEB_ONLY.has(path) && !path.split('/').some((part) => part.startsWith('.'));
}

// files: [{ path: 'assets/index-x.js', bytes: Buffer }]
export function createAppManifest(files, { build, minNativeApi }) {
  const entries = files
    .filter(({ path }) => isAppFile(path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ path, bytes }) => [path, { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }]);
  if (!entries.some(([path]) => path === 'index.html')) throw new Error('app manifest: dist/index.html이 없습니다.');
  return { format: MANIFEST_FORMAT, build, minNativeApi, files: Object.fromEntries(entries) };
}

// privateKeyBase64: generate-ota-key.mjs가 만든 PKCS#8 DER(base64). 서명은 base64로 돌려준다.
export function signManifest(manifestBytes, privateKeyBase64) {
  const key = createPrivateKey({ key: Buffer.from(privateKeyBase64.trim(), 'base64'), format: 'der', type: 'pkcs8' });
  return sign(null, manifestBytes, key).toString('base64');
}
