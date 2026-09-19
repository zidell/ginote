import { get, writable } from 'svelte/store';

export function queuedIssueIds(entries) {
  return new Set(entries.flatMap((entry) => entry.issues.map((issue) => issue.id)));
}

export function findEntryForIssue(entries, issueId) {
  return entries.find((entry) => entry.issues.some((issue) => issue.id === issueId));
}

// 휴지통 이동을 잠시 미뤄 두는 대기열이다. 유예 시간 안에는 취소할 수 있고,
// 시간이 지나면 항목을 처리 중(inFlight)으로 바꾼 뒤 onExpire(entry)를 부른다.
// 처리 중인 항목은 취소할 수 없다.
export function createDeletionQueue({ delayMs, onExpire }) {
  const entries = writable([]);
  let sequence = 0;

  function find(entryId) {
    return get(entries).find((entry) => entry.id === entryId);
  }

  function remove(entryId) {
    entries.update((list) => list.filter((entry) => entry.id !== entryId));
  }

  function expire(entryId) {
    const entry = find(entryId);
    if (!entry) return;
    const expired = { ...entry, timer: null, inFlight: true };
    entries.update((list) => list.map((item) => item.id === entryId ? expired : item));
    onExpire(expired);
  }

  function cancel(entryId) {
    const entry = find(entryId);
    if (!entry || entry.inFlight) return false;
    clearTimeout(entry.timer);
    remove(entryId);
    return true;
  }

  return {
    subscribe: entries.subscribe,

    // 이미 대기 중인 노트는 다시 넣지 않는다. 넣은 항목이 없으면 null이다.
    enqueue(issues, { nextState = 'closed', savePromise = null } = {}) {
      const queuedIds = queuedIssueIds(get(entries));
      const uniqueIssues = issues.filter((issue) => !queuedIds.has(issue.id));
      if (!uniqueIssues.length) return null;
      const entry = { id: ++sequence, issues: uniqueIssues, nextState, timer: null, inFlight: false, savePromise };
      entry.timer = setTimeout(() => expire(entry.id), delayMs);
      entries.update((list) => [...list, entry]);
      return entry;
    },

    cancel,

    cancelMostRecent() {
      const entry = [...get(entries)].reverse().find((item) => !item.inFlight);
      return entry ? cancel(entry.id) : false;
    },

    // force면 처리 중인 항목까지 대기열에서 뺀다(워크스페이스 전환·종료).
    cancelAll(force = false) {
      for (const entry of get(entries)) {
        if (!entry.inFlight || force) clearTimeout(entry.timer);
      }
      entries.update((list) => force ? [] : list.filter((entry) => entry.inFlight));
    },

    remove,

    isInFlight(entryId, issueId) {
      const entry = find(entryId);
      return Boolean(entry?.inFlight && entry.issues.some((issue) => issue.id === issueId));
    },

    // 처리가 끝난 노트를 항목에서 빼고, 남은 노트가 없으면 항목을 지운다.
    settle(entryId, issueId) {
      const entry = find(entryId);
      if (!entry) return;
      const remainingIssues = entry.issues.filter((issue) => issue.id !== issueId);
      if (!remainingIssues.length) {
        remove(entryId);
        return;
      }
      entries.update((list) => list.map((item) => item.id === entryId ? { ...item, issues: remainingIssues } : item));
    }
  };
}
