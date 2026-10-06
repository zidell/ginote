import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { devMetaCsp, headersFile, webMetaCsp } from './csp.config.js';
import { MANIFEST_FILE, SIGNATURE_FILE, createAppManifest, signManifest } from './app-manifest.config.js';
import { MIN_NATIVE_API } from './src/lib/native-api.js';

// index.html 안의 <style> 블록을 CSP 해시로 바꾼다. 이렇게 하면 style-src에
// 'unsafe-inline'을 열지 않고도 그 스타일만 통과시킬 수 있다.
function inlineStyleHashes(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map(([, css]) => `'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`);
}

// CSP는 csp.config.js 한 곳에서만 정의하고, index.html의 meta와 배포용 _headers 파일을
// 빌드 때 거기서 만들어 낸다. 손으로 두 곳을 맞추다 어긋나는 일을 없애기 위함이다.
function cspPlugin() {
  return {
    name: 'ginote-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const content = context.server ? devMetaCsp() : webMetaCsp(inlineStyleHashes(html));
        return {
          html,
          tags: [{
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content },
            injectTo: 'head-prepend'
          }]
        };
      }
    },
    generateBundle() {
      const hashes = inlineStyleHashes(readFileSync('index.html', 'utf8'));
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(hashes) });
    }
  };
}

// 빌드 번호는 HEAD 커밋 시각(초)이다. 같은 커밋을 웹과 앱에서 따로 빌드해도 같은 번호가
// 나오고, main에 쌓이는 커밋마다 커진다. git이 없는 환경에서는 빌드 시각을 쓴다.
// GINOTE_BUILD_NUMBER는 로컬에서 교체 흐름을 시험할 때만 쓴다.
function buildNumber() {
  if (process.env.GINOTE_BUILD_NUMBER) return Number(process.env.GINOTE_BUILD_NUMBER);
  try {
    return Number(execFileSync('git', ['log', '-1', '--format=%ct'], { encoding: 'utf8' }).trim());
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name));
}

// 앱(src-tauri)은 GitHub Pages의 app-manifest.json을 보고 프론트엔드를 교체한다
// (docs/APP_OTA.md). public/ 복사까지 끝난 dist를 기준으로 만들어야 하므로 closeBundle에서 돈다.
// GINOTE_OTA_SIGNING_KEY가 없으면 서명 파일을 만들지 않고, 앱은 그 빌드를 받지 않는다.
function appManifestPlugin() {
  let outDir;
  return {
    name: 'ginote-app-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = listFiles(outDir).map((file) => ({
        path: relative(outDir, file).split(sep).join('/'),
        bytes: readFileSync(file)
      }));
      const manifest = createAppManifest(files, { build: buildNumber(), minNativeApi: MIN_NATIVE_API });
      const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
      writeFileSync(join(outDir, MANIFEST_FILE), bytes);
      const key = process.env.GINOTE_OTA_SIGNING_KEY;
      if (key) {
        writeFileSync(join(outDir, SIGNATURE_FILE), `${signManifest(bytes, key)}\n`);
      } else {
        this.warn(`GINOTE_OTA_SIGNING_KEY가 없어 ${SIGNATURE_FILE}을 만들지 않았습니다. 앱은 이 빌드로 교체하지 않습니다.`);
      }
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), cspPlugin(), appManifestPlugin()],
  server: {
    strictPort: true,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), realpathSync('node_modules')]
    },
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  // 테스트(vitest)에서는 svelte 패키지의 서버용 빌드 대신 브라우저(클라이언트)용 빌드를 사용해야
  // @testing-library/svelte로 컴포넌트를 실제로 mount할 수 있다.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'jsdom',
    // 기본값인 forks는 워커가 별도 프로세스라, 테스트가 무한 루프에 빠진 채 vitest가 죽으면
    // 워커가 고아로 남아 CPU를 계속 쓴다. threads는 같은 프로세스 안이라 함께 종료된다.
    pool: 'threads',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,svelte}'],
      // main.js는 앱을 마운트하기만 하는 진입점이라 단위 테스트 대상에서 뺀다.
      exclude: ['src/main.js', 'src/**/*.test.js', 'src/**/__mocks__/**', 'src/**/__fixtures__/**'],
      reporter: ['text-summary', 'lcov']
    }
  }
});
