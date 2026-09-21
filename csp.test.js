import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, headersFile, tauriCsp, webHeaderCsp, webMetaCsp } from './csp.config.js';

// 테스트는 jsdom 환경에서 돌아 import.meta.url이 file: 주소가 아니므로 프로젝트 루트를 쓴다.
const tauriConfig = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'));

describe('콘텐츠 보안 정책', () => {
  it('Tauri 설정의 CSP가 csp.config.js와 일치한다', () => {
    // 어긋나면 이 테스트가 올바른 값을 알려준다. tauri.conf.json 쪽을 그 값으로 맞춘다.
    expect(tauriConfig.app.security.csp).toBe(tauriCsp());
  });

  it('style-src 속성 외에는 인라인도 eval도 허용하지 않는다', () => {
    const csp = webHeaderCsp();
    expect(csp).toContain("style-src 'self';");
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain("'unsafe-eval'");
    // 'unsafe-inline'이 나와도 되는 자리는 style-src-attr 하나뿐이다.
    expect(csp.match(/'unsafe-inline'/g)).toHaveLength(1);
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
  });

  it('GitHub과 OpenAI 밖으로는 아무 데도 접속하지 않는다', () => {
    const connectSrc = webHeaderCsp().match(/connect-src ([^;]+)/)[1].split(' ');
    expect(connectSrc.filter((source) => source.startsWith('https://')))
      .toEqual(['https://api.github.com', 'https://api.openai.com']);
  });

  it('폰트와 스타일을 외부 CDN에서 가져오지 않는다', () => {
    // 폰트를 self-host 하는 대신 CDN으로 되돌리면 사용자 IP가 그 CDN에 노출된다.
    for (const csp of [webHeaderCsp(), webMetaCsp(), tauriCsp()]) {
      expect(csp).not.toContain('fonts.googleapis.com');
      expect(csp).not.toContain('fonts.gstatic.com');
      expect(csp).not.toContain('cdn.jsdelivr.net');
      expect(csp).not.toContain('naver.github.io');
    }
  });

  it('분석·추적 도구를 허용하지 않는다', () => {
    // README가 "no analytics or tracking services are used"라고 약속한다.
    for (const csp of [webHeaderCsp(), webMetaCsp(), tauriCsp()]) {
      expect(csp).not.toContain('cloudflareinsights');
    }
  });

  it('meta 태그에서는 무시되는 지시어를 헤더 쪽에만 넣는다', () => {
    expect(webHeaderCsp()).toContain("frame-ancestors 'none'");
    expect(webMetaCsp()).not.toContain('frame-ancestors');
  });

  it('_headers 파일에 CSP와 보안 헤더를 모두 담는다', () => {
    const file = headersFile();
    expect(file.startsWith('/*\n')).toBe(true);
    expect(file).toContain(`Content-Security-Policy: ${webHeaderCsp()}`);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(file).toContain(`  ${name}: ${value}\n`);
    }
  });
});
