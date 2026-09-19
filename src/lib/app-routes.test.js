import { describe, expect, it } from 'vitest';
import {
  hasScreen,
  helpTopicFromRoute,
  isContentRoute,
  isHomeOrNoteHash,
  labelFromRoutes,
  queryMatchesLabel,
  segmentsWithPromotedNote,
  segmentsWithRenamedTag,
  tagRouteSegment
} from './app-routes.js';

function route(segment) {
  const [screen, ...rest] = segment.split('.');
  return { screen, segment, value: rest.join('.') };
}

describe('app-routes', () => {
  it('노트와 새 노트만 본문 레이어로 본다', () => {
    expect(isContentRoute(route('note.3'))).toBe(true);
    expect(isContentRoute(route('new'))).toBe(true);
    expect(isContentRoute(route('settings'))).toBe(false);
    expect(isContentRoute(undefined)).toBe(false);
  });

  it('스택에 특정 화면이 있는지 확인한다', () => {
    const stack = [route('tag.work'), route('settings')];
    expect(hasScreen(stack, 'settings')).toBe(true);
    expect(hasScreen(stack, 'voice')).toBe(false);
  });

  it('태그 레이어의 이름을 디코딩하고, 깨진 인코딩은 그대로 쓴다', () => {
    expect(labelFromRoutes([route(tagRouteSegment('할 일/급함'))])).toBe('할 일/급함');
    expect(labelFromRoutes([route('tag.%E0%A4%A')])).toBe('%E0%A4%A');
    expect(labelFromRoutes([route('note.1')])).toBe('');
    expect(labelFromRoutes([{ screen: 'tag', segment: 'tag', value: '' }])).toBe('');
  });

  it('검색어가 현재 태그 필터와 같은지 대소문자 없이 비교한다', () => {
    expect(queryMatchesLabel('  #Work ', 'work')).toBe(true);
    expect(queryMatchesLabel('work', 'work')).toBe(false);
    expect(queryMatchesLabel('#work', '')).toBe(false);
  });

  it('지원하는 안내 주제만 도움말로 연다', () => {
    expect(helpTopicFromRoute(route('help.keyboard'))).toBe('keyboard');
    expect(helpTopicFromRoute(route('help.unknown'))).toBeNull();
    expect(helpTopicFromRoute(route('note.1'))).toBeNull();
    expect(helpTopicFromRoute(undefined)).toBeNull();
  });

  it('태그 이름이 바뀌면 설정 레이어를 빼고 태그 경로를 새 이름으로 바꾼다', () => {
    const stack = [route('tag.old'), route('note.4'), route('settings')];
    expect(segmentsWithRenamedTag(stack, '새 이름')).toEqual([tagRouteSegment('새 이름'), 'note.4']);
    expect(segmentsWithRenamedTag(stack)).toEqual(['note.4']);
  });

  it('새 노트 레이어를 받은 번호의 노트 레이어로 바꾼다', () => {
    expect(segmentsWithPromotedNote([route('tag.work'), route('new')], 12)).toEqual(['tag.work', 'note.12']);
  });

  it('홈과 노트 주소만 목록 단축키 주소로 본다', () => {
    expect(isHomeOrNoteHash('#!/')).toBe(true);
    expect(isHomeOrNoteHash('#!')).toBe(true);
    expect(isHomeOrNoteHash('#!/note.42')).toBe(true);
    expect(isHomeOrNoteHash('#!/settings')).toBe(false);
    expect(isHomeOrNoteHash('#!/note.42/settings')).toBe(false);
  });
});
