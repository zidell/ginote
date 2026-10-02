import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeletionQueue, findEntryForIssue, queuedIssueIds } from './deletion-queue.js';

const a = { id: 1 };
const b = { id: 2 };
const c = { id: 3 };

let onExpire;
let queue;

beforeEach(() => {
  vi.useFakeTimers();
  onExpire = vi.fn();
  queue = createDeletionQueue({ delayMs: 3000, onExpire });
});

afterEach(() => vi.useRealTimers());

describe('deletion-queue', () => {
  it('유예 시간이 지나면 처리 중으로 바꾸고 알린다', () => {
    const entry = queue.enqueue([a, b], { savePromise: 'saving' });
    expect(entry).toMatchObject({ issues: [a, b], nextState: 'closed', inFlight: false, savePromise: 'saving' });

    vi.advanceTimersByTime(2999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onExpire).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id, inFlight: true, timer: null }));
    expect(get(queue)[0].inFlight).toBe(true);
  });

  it('이미 대기 중인 노트는 다시 넣지 않는다', () => {
    queue.enqueue([a]);
    expect(queue.enqueue([a])).toBeNull();
    const second = queue.enqueue([a, b]);
    expect(second.issues).toEqual([b]);
    expect(queuedIssueIds(get(queue))).toEqual(new Set([1, 2]));
    expect(findEntryForIssue(get(queue), 2).id).toBe(second.id);
  });

  it('취소하면 타이머를 멈추고 항목을 뺀다', () => {
    const entry = queue.enqueue([a]);
    expect(queue.cancel(entry.id)).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(get(queue)).toEqual([]);
    expect(queue.cancel(entry.id)).toBe(false);
  });

  it('처리 중인 항목은 취소할 수 없다', () => {
    const entry = queue.enqueue([a]);
    vi.advanceTimersByTime(3000);
    expect(queue.cancel(entry.id)).toBe(false);
    expect(get(queue)).toHaveLength(1);
  });

  it('가장 최근에 넣은, 아직 처리 전인 항목부터 취소한다', () => {
    const first = queue.enqueue([a]);
    vi.advanceTimersByTime(1000);
    const second = queue.enqueue([b]);
    vi.advanceTimersByTime(2000);
    // first는 이제 처리 중이다.
    expect(queue.cancelMostRecent()).toBe(true);
    expect(get(queue).map((entry) => entry.id)).toEqual([first.id]);
    expect(queue.cancelMostRecent()).toBe(false);
    expect(second).toBeTruthy();
  });

  it('전체 취소는 처리 중인 항목을 남기고, force면 모두 비운다', () => {
    queue.enqueue([a]);
    vi.advanceTimersByTime(3000);
    queue.enqueue([b]);
    queue.cancelAll();
    expect(get(queue).map((entry) => entry.issues)).toEqual([[a]]);

    queue.enqueue([c]);
    queue.cancelAll(true);
    expect(get(queue)).toEqual([]);
    vi.advanceTimersByTime(3000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('처리가 끝난 노트를 빼고, 모두 끝나면 항목을 지운다', () => {
    const entry = queue.enqueue([a, b]);
    vi.advanceTimersByTime(3000);
    expect(queue.isInFlight(entry.id, a.id)).toBe(true);
    expect(queue.isInFlight(entry.id, c.id)).toBe(false);

    queue.settle(entry.id, a.id);
    expect(get(queue)[0].issues).toEqual([b]);
    queue.settle(entry.id, b.id);
    expect(get(queue)).toEqual([]);
    expect(() => queue.settle(entry.id, b.id)).not.toThrow();
  });

  it('remove는 처리 중인 항목도 지운다', () => {
    const entry = queue.enqueue([a]);
    vi.advanceTimersByTime(3000);
    queue.remove(entry.id);
    expect(get(queue)).toEqual([]);
  });
});
