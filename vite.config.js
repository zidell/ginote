import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './',
  plugins: [svelte()],
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
