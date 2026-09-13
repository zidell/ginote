import { attachmentRawUrl } from './attachments.js';

function comparableDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

export function earliestIssue(issues) {
  return [...issues].sort((left, right) => (
    comparableDate(left.created_at) - comparableDate(right.created_at)
    || Number(left.number) - Number(right.number)
  ))[0] || null;
}

export function mergeTimeline(issues) {
  return issues
    .flatMap((issue) => [
      {
        kind: 'body',
        createdAt: issue.created_at,
        author: issue.user?.login || '',
        body: issue.body || '',
        issueNumber: issue.number,
        issueTitle: issue.title || ''
      },
      ...(issue.comments || []).map((comment) => ({
        kind: 'comment',
        createdAt: comment.createdAt,
        author: comment.author || '',
        body: comment.body || '',
        issueNumber: issue.number,
        issueTitle: issue.title || ''
      }))
    ])
    .sort((left, right) => (
      comparableDate(left.createdAt) - comparableDate(right.createdAt)
      || Number(left.issueNumber) - Number(right.issueNumber)
      || (left.kind === 'body' ? -1 : 1)
    ));
}

export function replaceAttachmentUrls(body, repo, replacements) {
  let result = String(body || '');
  for (const [sourcePath, targetPath] of replacements) {
    result = result.split(attachmentRawUrl(repo, sourcePath)).join(attachmentRawUrl(repo, targetPath));
  }
  return result;
}

export function formatMergedBody(entries) {
  const sections = entries.map((entry) => {
    const content = entry.body.trim() || '_내용 없음_';
    const author = entry.author ? ` @${entry.author}` : '';
    return `## ${formatMergeTimestamp(entry.createdAt)}${author}\n\n${content}`;
  });
  return sections.join('\n\n');
}

export function formatMergeTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '알 수 없는 시각';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
