import {
  createIssue,
  downloadAttachment,
  getIssue,
  listAllIssueAttachmentFiles,
  listIssueComments,
  setIssueState,
  updateIssue,
  uploadAttachment
} from './github.js';
import { MAX_ISSUE_BODY_LENGTH } from './github-limits.js';
import { translate } from './i18n.js';
import { uniqueIssueLabelNames } from './issue-labels.js';
import { earliestIssue, formatMergedBody, mergeTimeline, replaceAttachmentUrls } from './note-merge.js';

const PLACEHOLDER_BODY = '> 병합 기록을 준비하는 중입니다.';

// 병합 결과를 완성하지 못했을 때 던진다. draftNumber는 휴지통으로 보낸 임시 이슈 번호다.
export class MergeError extends Error {
  constructor(cause, draftNumber = null) {
    super(cause?.message || String(cause));
    this.name = 'MergeError';
    this.cause = cause;
    this.draftNumber = draftNumber;
  }
}

function assertWithinLimit(body) {
  if (body.length > MAX_ISSUE_BODY_LENGTH) {
    throw new Error(translate('dynamic.mergeTooLong', { limit: MAX_ISSUE_BODY_LENGTH }));
  }
}

async function loadSourceDetails(token, repo, sources) {
  // 목록 항목은 검색 결과일 수 있으므로, 병합 전에 본문·댓글·첨부의 최신 원본을
  // 모두 다시 읽는다. 이 단계에서는 원본을 전혀 변경하지 않는다.
  const details = [];
  for (const source of sources) {
    const issue = await getIssue(token, repo, source.number);
    const [comments, attachments] = await Promise.all([
      listIssueComments(token, repo, source.number),
      listAllIssueAttachmentFiles(token, repo, source.number)
    ]);
    details.push({ ...issue, comments, attachments });
  }
  return details;
}

async function copyAttachments(token, repo, sourceDetails, targetNumber) {
  const attachmentPaths = new Map();
  for (const source of sourceDetails) {
    for (const attachment of source.attachments) {
      const blob = await downloadAttachment(token, repo, attachment);
      const copied = await uploadAttachment(token, repo, targetNumber, new File(
        [blob],
        attachment.name,
        { type: blob.type || attachment.type || 'application/octet-stream' }
      ));
      attachmentPaths.set(attachment.path, copied.path);
    }
  }
  return attachmentPaths;
}

function withCopiedAttachmentUrls(sourceDetails, repo, attachmentPaths) {
  return sourceDetails.map((source) => ({
    ...source,
    body: replaceAttachmentUrls(source.body, repo, attachmentPaths),
    comments: source.comments.map((comment) => ({
      ...comment,
      body: replaceAttachmentUrls(comment.body, repo, attachmentPaths)
    }))
  }));
}

// 여러 노트를 시간순 기록 하나로 합친 새 노트를 만들고 원본을 휴지통으로 보낸다.
// 새 노트가 완성되기 전에는 원본을 닫지 않으므로, 어느 단계가 실패해도 원본 기록은 그대로 남는다.
export async function mergeIssues(token, repo, sources) {
  let draft = null;
  let mergedIssue;
  let sourceDetails;
  try {
    sourceDetails = await loadSourceDetails(token, repo, sources);
    const earliest = earliestIssue(sourceDetails);
    const title = earliest.title || translate('dynamic.mergedNoteTitle');
    const labels = uniqueIssueLabelNames(sourceDetails);
    assertWithinLimit(formatMergedBody(mergeTimeline(sourceDetails)));

    draft = await createIssue(token, repo, { title, body: PLACEHOLDER_BODY, labels });
    const attachmentPaths = await copyAttachments(token, repo, sourceDetails, draft.number);
    const body = formatMergedBody(mergeTimeline(withCopiedAttachmentUrls(sourceDetails, repo, attachmentPaths)));
    assertWithinLimit(body);
    mergedIssue = await updateIssue(token, repo, draft.number, { title, body, labels });
  } catch (reason) {
    // 완성 전의 결과물은 휴지통으로 보낸다. 복사된 파일은 그 이슈의 첨부로 남았다가
    // 기존 휴지통 정리 정책에 따라 함께 제거된다.
    if (draft) {
      try {
        await setIssueState(token, repo, draft.number, 'closed');
      } catch {
        // 원본은 여전히 안전하며, 닫지 못한 임시 이슈 번호는 오류 문구로 안내한다.
      }
    }
    throw new MergeError(reason, draft?.number ?? null);
  }

  const closeFailures = [];
  const closedSourceIds = new Set();
  for (const source of sourceDetails) {
    try {
      await setIssueState(token, repo, source.number, 'closed');
      closedSourceIds.add(source.id);
    } catch {
      closeFailures.push(source.number);
    }
  }
  return { mergedIssue, closedSourceIds, closeFailures };
}
