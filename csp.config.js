// 앱이 배포되는 두 경로(index.html의 meta, Tauri 설정)가 서로 다른 CSP를 갖지
// 않도록 여기 한 곳에서만 정의한다. meta는 빌드 때 이 파일로 생성하고,
// src-tauri/tauri.conf.json 의 값은 csp.test.js 가 이 파일과 일치하는지 검사한다.

// 앱은 웹과 같은 dist를 내장하거나 내려받아 쓰므로(docs/APP_OTA.md), index.html의 meta CSP가
// 그대로 Tauri WebView에도 적용된다. 그래서 브라우저에는 쓸모없는 ipc: 와 http://ipc.localhost 도
// 웹 쪽 connect-src 에 남겨둬야 한다. 이 둘을 빼면 앱의 IPC 호출이 CSP에 막힌다.
// (ipc: 스킴은 브라우저에 존재하지 않아 위험이 없다.)
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

// 앱이 내장·내려받은 자산을 열 때 Tauri가 응답 헤더로 거는 CSP다. 개발 모드는 Vite 개발
// 서버를 열어 devMetaCsp가 적용되므로 여기에는 운영 값만 둔다. index.html 안의 인라인
// <style> 해시는 Tauri가 자산에서 계산해 붙인다(src-tauri/src/ota.rs).
export function tauriCsp() {
  return serialize(BASE);
}

// Tauri 개발 모드용(tauri.conf.json의 devCsp). 모바일 개발 모드는 Vite 개발 서버를 Tauri
// 프로토콜로 중계하면서 이 값을 걸기 때문에, devMetaCsp처럼 HMR에 필요한 만큼 연다.
export function tauriDevCsp() {
  return devMetaCsp();
}
