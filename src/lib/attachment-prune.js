import { listExpiredClosedIssues, purgeIssueAttachments } from './github.js';

const ATTACHMENT_PRUNE_STORAGE_KEY = 'issue-note.attachment-prune.v1';
export const ATTACHMENT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function readPruneTimes() {
  return JSON.parse(localStorage.getItem(ATTACHMENT_PRUNE_STORAGE_KEY) || '{}');
}

export function shouldPruneExpiredAttachments(repo, now = Date.now()) {
  try {
    const lastPruned = Number(readPruneTimes()[repo]);
    return !Number.isFinite(lastPruned) || now - lastPruned >= ATTACHMENT_PRUNE_INTERVAL_MS;
  } catch {
    return true;
  }
}

export function markExpiredAttachmentsPruned(repo, now = Date.now()) {
  try {
    const prunedByRepository = readPruneTimes();
    prunedByRepository[repo] = now;
    localStorage.setItem(ATTACHMENT_PRUNE_STORAGE_KEY, JSON.stringify(prunedByRepository));
  } catch {
    // 정리 완료 시각을 기록하지 못해도 다음 연결 시 안전하게 다시 확인한다.
  }
}

// 보관 기간이 지난 휴지통 노트의 첨부파일을 지운다. 정리하는 도중 열려 있는 노트는 건너뛴다.
// 끝까지 정리했으면 true, 도중에 실패했으면 false다.
export async function purgeExpiredAttachments(token, repo, { isOpen = () => false } = {}) {
  try {
    const expiredIssues = await listExpiredClosedIssues(token, repo);
    for (const expiredIssue of expiredIssues) {
      if (isOpen(expiredIssue.number)) continue;
      await purgeIssueAttachments(token, repo, expiredIssue.number);
    }
    return true;
  } catch {
    // 백그라운드 정리 실패는 노트 사용 흐름을 방해하지 않고 다음 연결 때 재시도한다.
    return false;
  }
}
