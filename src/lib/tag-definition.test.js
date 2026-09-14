import { describe, expect, it } from 'vitest';
import { formatTagDefinition, parseTagDefinition } from './tag-definition.js';

describe('태그 정의 입력', () => {
  it('첫 :를 태그명과 분류 설명의 구분자로 해석한다', () => {
    expect(parseTagDefinition('culture: 책, 영화: 드라마')).toEqual({
      name: 'culture', description: '책, 영화: 드라마'
    });
  });

  it('기존 태그명에 :가 있어도 편집 중 이름을 보존한다', () => {
    const label = { name: 'area:seoul', description: '서울 지역 기록' };
    expect(formatTagDefinition(label)).toBe('area:seoul: 서울 지역 기록');
    expect(parseTagDefinition('area:seoul: 서울 지역 기록', label)).toEqual({
      name: 'area:seoul', description: '서울 지역 기록'
    });
  });
});
