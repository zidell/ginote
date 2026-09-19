import { describe, expect, it } from 'vitest';
import { rangeSelection, reconcileSelection, toggleSelection } from './issue-selection.js';

const issues = [
  { id: 'draft', local: true },
  { id: 1 },
  { id: 2 },
  { id: 3 },
  { id: 4 }
];

function ids(set) {
  return [...set].sort();
}

describe('toggleSelection', () => {
  it('하나를 누르면 선택을 뒤집고 기준점을 그 노트로 옮긴다', () => {
    const selected = toggleSelection({ selectedIds: new Set(), anchorId: null, issues, issue: issues[2] });
    expect(ids(selected.selectedIds)).toEqual([2]);
    expect(selected.anchorId).toBe(2);
    expect(selected.selected).toBe(true);

    const deselected = toggleSelection({ selectedIds: selected.selectedIds, anchorId: 2, issues, issue: issues[2] });
    expect(ids(deselected.selectedIds)).toEqual([]);
    expect(deselected.anchorId).toBeNull();
    expect(deselected.selected).toBe(false);
  });

  it('범위 선택은 로컬 초안을 건너뛰고 기준점에서 대상까지 더한다', () => {
    const next = toggleSelection({ selectedIds: new Set([1]), anchorId: 1, issues, issue: issues[3], range: true });
    expect(ids(next.selectedIds)).toEqual([1, 2, 3]);
    // 범위 선택은 기준점을 유지한다.
    expect(next.anchorId).toBe(1);
  });

  it('기준점이 목록에서 사라졌으면 범위 대신 대상만 더한다', () => {
    const next = toggleSelection({ selectedIds: new Set([9]), anchorId: 9, issues, issue: issues[4], range: true });
    expect(ids(next.selectedIds)).toEqual([4, 9]);
  });

  it('기준점이 없으면 범위 선택도 단일 선택처럼 동작한다', () => {
    const next = toggleSelection({ selectedIds: new Set(), anchorId: null, issues, issue: issues[1], range: true });
    expect(ids(next.selectedIds)).toEqual([1]);
    expect(next.anchorId).toBeNull();
  });
});

describe('rangeSelection', () => {
  it('방향과 상관없이 두 위치 사이를 고른다', () => {
    expect(ids(rangeSelection(issues, 4, 1))).toEqual([1, 2, 3, 4]);
    expect(ids(rangeSelection(issues, 0, 2))).toEqual([1, 2]);
  });
});

describe('reconcileSelection', () => {
  it('선택이 없거나 그대로 남아 있으면 바꾸지 않는다', () => {
    expect(reconcileSelection({ selectedIds: new Set(), anchorId: null, issues })).toBeNull();
    expect(reconcileSelection({ selectedIds: new Set([1, 2]), anchorId: 1, issues })).toBeNull();
  });

  it('사라진 노트를 빼고, 기준점이 사라졌으면 남은 첫 노트로 옮긴다', () => {
    const next = reconcileSelection({ selectedIds: new Set([7, 2, 3]), anchorId: 7, issues });
    expect(ids(next.selectedIds)).toEqual([2, 3]);
    expect(next.anchorId).toBe(2);
  });

  it('모두 사라지면 기준점도 비운다', () => {
    const next = reconcileSelection({ selectedIds: new Set([7]), anchorId: 7, issues });
    expect(next).toEqual({ selectedIds: new Set(), anchorId: null });
  });
});
