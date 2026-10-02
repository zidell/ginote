import { describe, expect, it } from 'vitest';
import {
  applyPendingPin,
  applyPendingPinToList,
  restorePinnedList,
  samePinIssue,
  syncPinnedList,
  uniquePinnedIssues
} from './pinned-issues.js';
import { hasPinLabel, withPinState } from './pin-label.js';

const pinLabel = { name: 'ginote:pin' };

function issue(id, pinned = false) {
  return { id, number: id * 10, labels: pinned ? [pinLabel] : [] };
}

function mutation(target, desiredPinned, extra = {}) {
  return {
    issue: target,
    desiredPinned,
    wasPinned: !desiredPinned,
    optimisticIssue: withPinState(target, desiredPinned),
    previousPinnedIssue: null,
    ...extra
  };
}

describe('samePinIssue', () => {
  it('id가 있으면 id로, 없으면 번호로 비교한다', () => {
    expect(samePinIssue({ id: 1 }, { id: '1' })).toBe(true);
    expect(samePinIssue({ id: 1, number: 5 }, { id: 2, number: 5 })).toBe(false);
    expect(samePinIssue({ number: 5 }, { id: 2, number: '5' })).toBe(true);
    expect(samePinIssue(null, { id: 1 })).toBe(false);
    expect(samePinIssue({}, {})).toBe(false);
  });
});

describe('uniquePinnedIssues', () => {
  it('중복과 식별자 없는 항목을 뺀다', () => {
    const list = [issue(1), issue(1), { number: 7 }, {}, null];
    expect(uniquePinnedIssues(list)).toEqual([issue(1), { number: 7 }]);
  });
});

describe('진행 중인 고정 요청 반영', () => {
  it('대상 노트에만 원하는 고정 상태를 덮어쓴다', () => {
    const pending = mutation(issue(1), true);
    expect(hasPinLabel(applyPendingPin(issue(1), pending))).toBe(true);
    expect(applyPendingPin(issue(2), pending)).toEqual(issue(2));
    expect(applyPendingPin(issue(1), null)).toEqual(issue(1));
  });

  it('고정 목록 맨 앞에 넣거나 목록에서 뺀다', () => {
    const list = [issue(2, true), issue(3, true)];
    expect(applyPendingPinToList(list, mutation(issue(1), true)).map((item) => item.id)).toEqual([1, 2, 3]);
    expect(applyPendingPinToList(list, mutation(issue(3), false)).map((item) => item.id)).toEqual([2]);
    expect(applyPendingPinToList(list, null)).toBe(list);
  });

  it('이미 목록에 있으면 서버에서 받은 항목을 앞으로 옮긴다', () => {
    const fromServer = { ...issue(3, true), title: '서버 값' };
    const next = applyPendingPinToList([issue(2, true), fromServer], mutation(issue(3), true));
    expect(next[0].title).toBe('서버 값');
  });
});

describe('syncPinnedList', () => {
  it('고정 라벨이 있으면 목록을 갱신하거나 맨 앞에 넣는다', () => {
    const updated = { ...issue(2, true), title: '새 제목' };
    expect(syncPinnedList([issue(1, true), issue(2, true)], updated)[1].title).toBe('새 제목');
    expect(syncPinnedList([issue(1, true)], issue(3, true)).map((item) => item.id)).toEqual([3, 1]);
  });

  it('고정 라벨이 없으면 목록에서 뺀다', () => {
    const list = [issue(1, true)];
    expect(syncPinnedList(list, issue(1))).toEqual([]);
    expect(syncPinnedList(list, issue(9))).toBe(list);
  });
});

describe('restorePinnedList', () => {
  const restore = (source) => withPinState(source, true);

  it('원래 고정이 아니었으면 목록에서 뺀다', () => {
    const failed = mutation(issue(1), true);
    expect(restorePinnedList([issue(1, true), issue(2, true)], failed, restore).map((item) => item.id)).toEqual([2]);
  });

  it('원래 고정이었으면 이전 항목을 되살린다', () => {
    const previous = { ...issue(1, true), title: '이전' };
    const failed = mutation(issue(1), false, { wasPinned: true, previousPinnedIssue: previous });
    const restored = restorePinnedList([issue(2, true)], failed, restore);
    expect(restored.map((item) => item.id)).toEqual([1, 2]);
    expect(restored[0].title).toBe('이전');
  });

  it('목록에 남아 있으면 그 자리에서 되돌린다', () => {
    const failed = mutation(issue(2), false, { wasPinned: true });
    const restored = restorePinnedList([issue(1, true), issue(2)], failed, restore);
    expect(restored.map((item) => item.id)).toEqual([1, 2]);
    expect(hasPinLabel(restored[1])).toBe(true);
  });
});
