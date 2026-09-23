// Pages Functions 가 이 배포에서 실제로 실행되는지 확인하는 임시 프로브다. 확인 후 지운다.
export function onRequest() {
  return new Response('functions-alive\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
