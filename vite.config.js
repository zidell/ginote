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
    environment: 'jsdom'
  }
});
