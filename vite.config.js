import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { devMetaCsp, headersFile, webMetaCsp } from './csp.config.js';

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

export default defineConfig({
  base: './',
  plugins: [svelte(), cspPlugin()],
  server: {
    strictPort: true,
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
