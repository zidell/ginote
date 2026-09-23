// 루트 주소 하나로 사람과 에이전트를 함께 상대한다. 브라우저에는 지금까지처럼 앱이 담긴
// HTML을 주고, text/markdown 을 요구한 클라이언트에는 guide.md 를 내려준다. HTTP 표준의
// Accept 협상(RFC 9110)이라 에이전트 전용 주소나 별도 규약을 만들 필요가 없다.

const GUIDE_PATH = '/guide.md';

// Accept 에 명시된 타입의 q값과 등장 순서를 읽는다. */* 나 text/* 같은 와일드카드는
// 세지 않는다 — 브라우저도 curl도 늘 */* 를 붙여 보내므로, 그걸 근거로 삼으면 사람에게
// 마크다운 파일을 다운로드시키게 된다.
function explicitPreference(accept, type) {
  const entries = accept.split(',');
  for (let index = 0; index < entries.length; index += 1) {
    const [value, ...params] = entries[index].split(';');
    if (value.trim().toLowerCase() !== type) continue;
    const weight = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
    const parsed = weight ? Number.parseFloat(weight.slice(2)) : 1;
    return { quality: Number.isFinite(parsed) ? parsed : 1, index };
  }
  return { quality: 0, index: Number.MAX_SAFE_INTEGER };
}

// q값이 같으면 먼저 적은 쪽을 택한다. "text/markdown, text/html" 은 마크다운을,
// "text/html, text/markdown" 은 HTML을 원하는 클라이언트로 본다.
function prefersMarkdown(accept) {
  const markdown = explicitPreference(accept, 'text/markdown');
  if (markdown.quality <= 0) return false;

  const html = explicitPreference(accept, 'text/html');
  if (markdown.quality !== html.quality) return markdown.quality > html.quality;
  return markdown.index < html.index;
}

export async function onRequest({ request, env }) {
  const isRead = request.method === 'GET' || request.method === 'HEAD';

  if (isRead && prefersMarkdown(request.headers.get('accept') || '')) {
    try {
      const guide = await env.ASSETS.fetch(new Request(new URL(GUIDE_PATH, request.url)));
      if (guide.ok) {
        const headers = new Headers(guide.headers);
        headers.set('Content-Type', 'text/markdown; charset=utf-8');
        headers.set('Vary', 'Accept');
        return new Response(request.method === 'HEAD' ? null : guide.body, { status: 200, headers });
      }
    } catch {
      // 가이드를 읽지 못하면 평소대로 앱을 내려준다. 협상 실패가 사이트를 막아서는 안 된다.
    }
  }

  // 같은 주소가 요청에 따라 다른 표현을 주므로 캐시가 둘을 섞지 않도록 알린다.
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.append('Vary', 'Accept');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
