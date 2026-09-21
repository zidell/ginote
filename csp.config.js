// 앱이 배포되는 세 경로(웹 헤더, index.html의 meta, Tauri 설정)가 서로 다른 CSP를 갖지
// 않도록 여기 한 곳에서만 정의한다. 웹 헤더와 meta는 빌드 때 이 파일로 생성하고,
// src-tauri/tauri.conf.json 의 값은 csp.test.js 가 이 파일과 일치하는지 검사한다.

// 데스크톱 앱은 자체 번들이 아니라 웹과 같은 주소(frontendDist: https://note.gitools.net)를
// 열기 때문에, 웹으로 내려보내는 CSP가 그대로 Tauri WebView에도 적용된다. 그래서 브라우저에는
// 쓸모없는 ipc: 와 http://ipc.localhost 도 웹 쪽 connect-src 에 남겨둬야 한다. 이 둘을 빼면
// 데스크톱 앱의 IPC 호출이 CSP에 막힌다. (ipc: 스킴은 브라우저에 존재하지 않아 위험이 없다.)
const TAURI_IPC = ['ipc:', 'http://ipc.localhost'];

const BASE = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  // GitHub은 노트·첨부 저장소, OpenAI는 선택 기능인 음성 전사·정리에만 쓴다.
  'connect-src': ["'self'", ...TAURI_IPC, 'https://api.github.com', 'https://api.openai.com'],
  // 첨부 이미지는 github.com/{저장소}/raw/... 로, 프로필 사진은 avatars 도메인으로 온다.
  'img-src': ["'self'", 'blob:', 'data:', 'https://avatars.githubusercontent.com', 'https://github.com'],
  // 녹음 미리듣기와 오디오 첨부는 blob: URL로 재생한다.
  'media-src': ["'self'", 'blob:'],
  // 코딩 폰트를 self-host 하므로 외부 스타일시트도 외부 폰트도 필요 없다.
  // index.html에 들어있는 <style>(JS가 꺼진 브라우저용 안내 화면)만 해시로 따로 허용한다.
  'style-src': ["'self'"],
  // 사이드바 너비처럼 값이 실시간으로 바뀌는 자리에 style="" 속성을 쓴다. 속성은 스크립트를
  // 실행할 수 없어 <style> 요소를 허용하는 것보다 훨씬 안전하므로 여기만 인라인을 연다.
  'style-src-attr': ["'unsafe-inline'"],
  'font-src': ["'self'"],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  // 모든 <form>은 on:submit|preventDefault 로 처리하고 실제로 제출하지 않는다.
  'form-action': ["'none'"],
  'frame-src': ["'none'"],
  'child-src': ["'none'"]
};

function serialize(directives) {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

// styleHashes 에는 index.html 안의 <style> 내용을 sha256으로 계산한 값이 들어온다.
// 'unsafe-inline' 대신 이 해시를 쓰면 그 스타일 하나만 정확히 허용되고, 공격자가 끼워 넣은
// 다른 인라인 스타일은 계속 막힌다. 해시는 vite.config.js가 빌드할 때 직접 계산한다.
function withStyleHashes(directives, styleHashes) {
  return { ...directives, 'style-src': [...directives['style-src'], ...styleHashes] };
}

// meta 태그로는 frame-ancestors 가 무시되므로 HTTP 헤더 쪽에만 넣는다.
export function webHeaderCsp(styleHashes = []) {
  return serialize({ ...withStyleHashes(BASE, styleHashes), 'frame-ancestors': ["'none'"] });
}

export function webMetaCsp(styleHashes = []) {
  return serialize(withStyleHashes(BASE, styleHashes));
}

// Vite 개발 서버는 HMR을 위해 인라인 스크립트·스타일과 웹소켓을 쓴다. 운영 CSP를 그대로
// 걸면 개발이 되지 않으므로 개발 서버에서만 그만큼 연다.
export function devMetaCsp() {
  const devServer = ['http://localhost:5173', 'ws://localhost:5173'];
  return serialize({
    ...BASE,
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'connect-src': [...BASE['connect-src'], ...devServer]
  });
}

// Tauri는 개발할 때만 자체 CSP를 쓴다(운영에서는 원격 주소를 열어 웹 헤더가 적용된다).
// 로컬 자산 프로토콜과 개발 서버 주소가 더 필요하다.
export function tauriCsp() {
  return serialize({
    ...BASE,
    'connect-src': [...BASE['connect-src'], 'http://localhost:5173', 'ws://localhost:5173'],
    'img-src': [...BASE['img-src'], 'asset:', 'http://asset.localhost'],
    'style-src': ["'self'", "'unsafe-inline'"]
  });
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // 마이크는 음성 녹음 기능에만 쓰고 나머지 강력한 기능은 모두 끈다.
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), midi=(), bluetooth=()',
  // frame-ancestors 를 이해하지 못하는 오래된 브라우저를 위한 보조 장치다.
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  // 창을 열어준 쪽과 브라우징 컨텍스트를 공유하지 않는다.
  'Cross-Origin-Opener-Policy': 'same-origin',
  // 다른 사이트가 이 앱의 파일을 직접 가져다 쓰지 못하게 한다.
  'Cross-Origin-Resource-Policy': 'same-origin'
};

export function headersFile(styleHashes = []) {
  const lines = ['/*', `  Content-Security-Policy: ${webHeaderCsp(styleHashes)}`];
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) lines.push(`  ${name}: ${value}`);
  return `${lines.join('\n')}\n`;
}
