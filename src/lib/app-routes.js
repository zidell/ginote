// 노트 본문을 여는 화면이다. 목록 옆(데스크톱)이나 위(모바일)에 레이어로 쌓인다.
export const CONTENT_SCREENS = ['note', 'new'];
export const HELP_TOPICS = new Set(['security', 'mcp', 'app', 'keyboard']);

export function isContentRoute(route) {
  return CONTENT_SCREENS.includes(route?.screen);
}

export function hasScreen(routes, screen) {
  return routes.some((route) => route.screen === screen);
}

export function labelFromRoutes(routes) {
  const route = routes.find((item) => item.screen === 'tag');
  if (!route?.value) return '';
  try {
    return decodeURIComponent(route.value);
  } catch {
    return route.value;
  }
}

export function queryMatchesLabel(queryValue, labelName) {
  return Boolean(
    labelName
    && queryValue.trim().toLocaleLowerCase() === `#${labelName}`.toLocaleLowerCase()
  );
}

export function helpTopicFromRoute(route) {
  return route?.screen === 'help' && HELP_TOPICS.has(route.value) ? route.value : null;
}

export function tagRouteSegment(labelName) {
  return `tag.${encodeURIComponent(labelName)}`;
}

// 태그 이름이 바뀌거나 지워진 뒤 돌아갈 경로다. 설정 레이어는 빼고,
// 새 이름이 없으면(삭제) 태그 레이어도 뺀다.
export function segmentsWithRenamedTag(routes, nextName = '') {
  return routes
    .filter((route) => route.screen !== 'settings')
    .filter((route) => nextName || route.screen !== 'tag')
    .map((route) => route.screen === 'tag' ? tagRouteSegment(nextName) : route.segment);
}

// 새 노트가 번호를 받으면 new 레이어를 같은 위치의 note.{번호}로 바꾼다.
export function segmentsWithPromotedNote(routes, issueNumber) {
  return routes.map((route) => route.screen === 'new' ? `note.${issueNumber}` : route.segment);
}

// 라우터가 스택을 갱신하기 전에도 목록 단축키를 쓸 수 있는 주소인지 판단한다.
export function isHomeOrNoteHash(hash) {
  return /^#!\/?$/.test(hash) || /^#!\/note\.\d+$/.test(hash);
}
