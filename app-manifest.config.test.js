import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAppManifest, isAppFile, signManifest } from './app-manifest.config.js';

const file = (path, text) => ({ path, bytes: Buffer.from(text) });

describe('앱 매니페스트', () => {
  it('웹 전용 파일과 숨김 파일은 앱에 내려보내지 않는다', () => {
    for (const path of ['sw.js', 'og-image.png', 'landing-preview.gif', 'sitemap.xml', 'robots.txt', 'app-manifest.json', 'app-manifest.json.sig', '.DS_Store', 'fonts/.keep']) {
      expect(isAppFile(path)).toBe(false);
    }
    expect(isAppFile('assets/index-abc.js')).toBe(true);
  });

  it('파일을 경로순으로 정렬하고 sha256과 크기를 기록한다', () => {
    const manifest = createAppManifest(
      [file('sw.js', 'x'), file('index.html', '<html>'), file('assets/a.js', 'a')],
      { build: 1700000000, minNativeApi: 1 }
    );
    expect(manifest).toEqual({
      format: 1,
      build: 1700000000,
      minNativeApi: 1,
      files: {
        'assets/a.js': { sha256: createHash('sha256').update('a').digest('hex'), size: 1 },
        'index.html': { sha256: createHash('sha256').update('<html>').digest('hex'), size: 6 }
      }
    });
    expect(Object.keys(manifest.files)).toEqual(['assets/a.js', 'index.html']);
  });

  it('index.html이 없으면 매니페스트를 만들지 않는다', () => {
    expect(() => createAppManifest([file('assets/a.js', 'a')], { build: 1, minNativeApi: 1 })).toThrow();
  });

  it('서명은 매니페스트 바이트 그대로에 대한 Ed25519 서명이다', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const keyBase64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const bytes = Buffer.from('{"format":1}\n');
    const signature = Buffer.from(signManifest(bytes, `${keyBase64}\n`), 'base64');
    expect(signature).toHaveLength(64);
    expect(verify(null, bytes, publicKey, signature)).toBe(true);
    expect(verify(null, Buffer.from('{"format":2}\n'), publicKey, signature)).toBe(false);
  });
});
