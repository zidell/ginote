import { describe, expect, it } from 'vitest';
import { dueBadge, dueBadgeLabel, parseDueDate } from './due-date.js';

describe('parseDueDate', () => {
  it('첫 줄이 Due 표기면 날짜를 읽는다', () => {
    expect(parseDueDate('Due: 2026-09-23\n본문')).toEqual(new Date(2026, 8, 23));
  });

  it('대소문자와 공백, 마크다운 강조·헤딩을 허용한다', () => {
    expect(parseDueDate('due:2026-09-23')).toEqual(new Date(2026, 8, 23));
    expect(parseDueDate('**Due: 2026-09-23**')).toEqual(new Date(2026, 8, 23));
    expect(parseDueDate('## Due: 2026-9-3')).toEqual(new Date(2026, 8, 3));
  });

  it('첫 줄이 아니면 읽지 않는다', () => {
    expect(parseDueDate('회의 준비\nDue: 2026-09-23')).toBeNull();
  });

  it('Due 뒤에 다른 내용이 붙으면 읽지 않는다', () => {
    expect(parseDueDate('Due: 2026-09-23 최종 제출')).toBeNull();
  });

  it('없는 날짜나 빈 값은 무시한다', () => {
    expect(parseDueDate('Due: 2026-02-30')).toBeNull();
    expect(parseDueDate('Due: 2026-13-01')).toBeNull();
    expect(parseDueDate('Due: 내일')).toBeNull();
    expect(parseDueDate('')).toBeNull();
    expect(parseDueDate(null)).toBeNull();
  });
});

describe('dueBadgeLabel', () => {
  it('남은 날은 D-xx, 당일은 D-DAY, 지난 날은 D+xx로 적는다', () => {
    expect(dueBadgeLabel(3)).toBe('D-3');
    expect(dueBadgeLabel(0)).toBe('D-DAY');
    expect(dueBadgeLabel(-2)).toBe('D+2');
  });
});

describe('dueBadge', () => {
  const now = new Date(2026, 8, 22, 18, 30);

  it('기준 시각의 시분과 무관하게 날짜 차이로 계산한다', () => {
    expect(dueBadge('Due: 2026-09-23', now)).toEqual({ days: 1, label: 'D-1', date: '2026-09-23' });
    expect(dueBadge('Due: 2026-09-22', now)).toEqual({ days: 0, label: 'D-DAY', date: '2026-09-22' });
    expect(dueBadge('Due: 2026-09-20', now)).toEqual({ days: -2, label: 'D+2', date: '2026-09-20' });
  });

  it('달과 해를 넘겨도 일수를 맞게 센다', () => {
    expect(dueBadge('Due: 2026-10-02', now).label).toBe('D-10');
    expect(dueBadge('Due: 2027-01-01', now).days).toBe(101);
  });

  it('Due 표기가 없으면 배지를 만들지 않는다', () => {
    expect(dueBadge('장보기 목록\n- 우유', now)).toBeNull();
  });
});
