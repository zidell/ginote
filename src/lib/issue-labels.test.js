import { describe, expect, it } from 'vitest';
import {
  countIssueLabels,
  hasIssueLabel,
  limitTagInput,
  mergeLabels,
  replaceIssueLabel,
  replaceLabelName,
  sortLabels,
  tagOptions,
  uniqueIssueLabelNames
} from './issue-labels.js';

function labels(...names) {
  return names.map((name) => ({ name }));
}

describe('노트 태그 조회와 변경', () => {
  it('태그 이름을 대소문자 없이 찾는다', () => {
    const issue = { labels: labels('Work') };
    expect(hasIssueLabel(issue, 'work')).toBe(true);
    expect(hasIssueLabel(issue, 'home')).toBe(false);
    expect(hasIssueLabel(null, 'work')).toBeUndefined();
  });

  it('노트의 태그 이름을 바꾸거나 뗀다', () => {
    const issue = { id: 1, labels: [{ name: 'Work', color: 'red' }, { name: 'home' }] };
    expect(replaceIssueLabel(issue, 'work', 'job').labels).toEqual([{ name: 'job', color: 'red' }, { name: 'home' }]);
    expect(replaceIssueLabel(issue, 'WORK').labels).toEqual([{ name: 'home' }]);
    expect(replaceIssueLabel(null, 'work')).toBeNull();
    // 원본은 바꾸지 않는다.
    expect(issue.labels[0].name).toBe('Work');
  });

  it('이름 목록에서도 같은 규칙으로 바꾼다', () => {
    expect(replaceLabelName(['Work', 'home'], 'work', 'job')).toEqual(['job', 'home']);
    expect(replaceLabelName(['Work', 'home'], 'work')).toEqual(['home']);
  });
});

describe('여러 노트의 태그 집계', () => {
  const issues = [
    { labels: labels('Work', 'ginote:pin', ' ') },
    { labels: labels('work', 'home') },
    { labels: [] },
    {}
  ];

  it('고정 라벨과 빈 이름을 빼고 대소문자 없이 합친다', () => {
    expect(uniqueIssueLabelNames(issues)).toEqual(['work', 'home']);
  });

  it('태그별로 붙은 노트 수를 센다', () => {
    const counts = countIssueLabels(issues);
    expect(counts.get('work')).toBe(2);
    expect(counts.get('home')).toBe(1);
    expect(counts.has('ginote:pin')).toBe(false);
  });

  it('이미 붙은 태그를 먼저, 그다음 이름순으로 보여 주고 검색어로 거른다', () => {
    const repositoryLabels = labels('alpha', 'home', 'work', 'beta');
    const counts = countIssueLabels(issues);
    expect(tagOptions(repositoryLabels, counts, '', 'en')).toEqual([
      { name: 'home', count: 1 },
      { name: 'work', count: 2 },
      { name: 'alpha', count: 0 },
      { name: 'beta', count: 0 }
    ]);
    expect(tagOptions(repositoryLabels, counts, ' ##O ', 'en').map((option) => option.name)).toEqual(['home', 'work']);
  });
});

describe('저장소 태그 목록', () => {
  it('같은 이름은 새 값으로 덮어쓰고 정렬한다', () => {
    const merged = mergeLabels([{ name: 'b', id: 1 }, { name: 'A', id: 2 }], [{ name: 'a', id: 3 }, { name: 'c', id: 4 }], 'en');
    expect(merged).toEqual([{ name: 'a', id: 3 }, { name: 'b', id: 1 }, { name: 'c', id: 4 }]);
  });

  it('원본 배열을 바꾸지 않고 정렬한다', () => {
    const original = labels('b', 'a');
    expect(sortLabels(original, 'en').map((label) => label.name)).toEqual(['a', 'b']);
    expect(original.map((label) => label.name)).toEqual(['b', 'a']);
  });
});

describe('limitTagInput', () => {
  it('이름 50자, 설명 100자로 자르고 앞뒤 공백을 없앤다', () => {
    const limited = limitTagInput({ name: `  ${'가'.repeat(60)}  `, description: 'x'.repeat(120) });
    expect(limited.name).toBe('가'.repeat(50));
    expect(limited.description).toBe('x'.repeat(100));
  });

  it('이모지를 반으로 쪼개지 않는다', () => {
    const limited = limitTagInput({ name: '😀'.repeat(51) });
    expect(Array.from(limited.name)).toHaveLength(50);
    expect(limited.name).toBe('😀'.repeat(50));
  });

  it('값이 없으면 빈 문자열이다', () => {
    expect(limitTagInput(null)).toEqual({ name: '', description: '' });
  });
});
