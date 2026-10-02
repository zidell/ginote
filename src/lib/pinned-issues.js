import { hasPinLabel, withPinState } from './pin-label.js';

export function uniquePinnedIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = String(issue?.id ?? issue?.number ?? '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 낙관적으로 만든 이슈에는 id가 없을 수 있어 번호로도 비교한다.
export function samePinIssue(left, right) {
  if (!left || !right) return false;
  if (left.id != null && right.id != null) return String(left.id) === String(right.id);
  return left.number != null && right.number != null
    && Number(left.number) === Number(right.number);
}

// 고정 요청이 끝나기 전에 도착한 목록 응답에도 사용자가 고른 고정 상태를 덮어쓴다.
export function applyPendingPin(issue, mutation) {
  return mutation && samePinIssue(issue, mutation.issue)
    ? withPinState(issue, mutation.desiredPinned)
    : issue;
}

export function applyPendingPinToList(pinList, mutation) {
  if (!mutation) return pinList;
  const existing = pinList.find((issue) => samePinIssue(issue, mutation.issue));
  const withoutTarget = pinList.filter((issue) => !samePinIssue(issue, mutation.issue));
  if (!mutation.desiredPinned) return withoutTarget;
  return [withPinState(existing || mutation.optimisticIssue, true), ...withoutTarget];
}

// 이슈의 고정 라벨 유무에 맞춰 고정 목록을 갱신한다.
export function syncPinnedList(pinnedIssues, issue) {
  const index = pinnedIssues.findIndex((item) => samePinIssue(item, issue));
  if (hasPinLabel(issue)) {
    return index >= 0
      ? pinnedIssues.map((item) => samePinIssue(item, issue) ? issue : item)
      : [issue, ...pinnedIssues];
  }
  return index >= 0 ? pinnedIssues.filter((item) => !samePinIssue(item, issue)) : pinnedIssues;
}

// 고정 요청이 실패했을 때 요청 전 고정 목록으로 되돌린다.
export function restorePinnedList(pinnedIssues, mutation, restoreIssue) {
  const currentPinned = pinnedIssues.find((item) => samePinIssue(item, mutation.issue));
  if (!mutation.wasPinned) return pinnedIssues.filter((item) => !samePinIssue(item, mutation.issue));
  const restored = restoreIssue(currentPinned || mutation.previousPinnedIssue);
  return currentPinned
    ? pinnedIssues.map((item) => samePinIssue(item, mutation.issue) ? restored : item)
    : [restored, ...pinnedIssues];
}
