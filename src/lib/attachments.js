function encodedPath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function isImage(attachment) {
  return attachment?.type?.startsWith('image/')
    || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(attachment?.name || '');
}

export function composeAttachmentLink(repo, attachment) {
  const fileUrl = attachmentRawUrl(repo, attachment.path);
  return isImage(attachment) ? `![](${fileUrl})` : `[](${fileUrl})`;
}

export function attachmentRawUrl(repo, path) {
  return `https://github.com/${repo}/raw/HEAD/${encodedPath(path)}`;
}

const RAW_ATTACHMENT_LINK = /!?\[(?:\\.|[^\]\n])*\]\(https:\/\/github\.com\/[^/)\s]+\/[^/)\s]+\/raw\/HEAD\/([^)\s]+)\)/g;
const MANAGED_ATTACHMENT_BLOCK = /(?:^|\n)<!-- ginote:attachments:start -->\s*[\s\S]*?\s*<!-- ginote:attachments:end -->(?=\n|$)/g;

export const MANAGED_ATTACHMENT_START = '<!-- ginote:attachments:start -->';
export const MANAGED_ATTACHMENT_END = '<!-- ginote:attachments:end -->';

export function parseAttachmentPaths(bodyText) {
  const paths = [];
  const text = String(bodyText || '');
  let match;
  RAW_ATTACHMENT_LINK.lastIndex = 0;
  while ((match = RAW_ATTACHMENT_LINK.exec(text))) {
    paths.push(match[1].split('/').map(decodeURIComponent).join('/'));
  }
  return paths;
}

export function removeAttachmentLink(bodyText, link) {
  return String(bodyText || '').split(link).join('').replace(/\n{3,}/g, '\n\n').trim();
}

export function insertAttachmentLinks(bodyText, links, position = null) {
  const text = String(bodyText || '');
  const cursor = position === null ? text.length : Math.min(Math.max(position, 0), text.length);
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);
  const block = links.join('\n\n');
  const leading = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trailing = after === '' ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return `${before}${leading}${block}${trailing}${after}`;
}

// 경계만 HTML 주석이다. 그 사이의 Markdown 링크는 GitHub Issue에서 그대로
// 렌더링되고, Ginote는 편집할 때만 이 자동 생성 영역을 숨긴다.
export function stripManagedAttachmentBlocks(bodyText) {
  const text = String(bodyText || '');
  if (!text.includes(MANAGED_ATTACHMENT_START)) return text;
  return text
    .replace(MANAGED_ATTACHMENT_BLOCK, '')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

export function managedAttachmentLinks(bodyText) {
  const text = String(bodyText || '');
  const blocks = text.match(MANAGED_ATTACHMENT_BLOCK) || [];
  const links = [];
  for (const block of blocks) {
    RAW_ATTACHMENT_LINK.lastIndex = 0;
    let match;
    while ((match = RAW_ATTACHMENT_LINK.exec(block))) links.push(match[0]);
  }
  return links;
}

export function withManagedAttachmentBlock(bodyText, links) {
  const body = stripManagedAttachmentBlocks(bodyText);
  if (!links.length) return body;
  const block = [
    MANAGED_ATTACHMENT_START,
    links.join('\n\n'),
    MANAGED_ATTACHMENT_END
  ].join('\n\n');
  return body ? `${block}\n\n${body}` : block;
}

export const ATTACHMENT_LINK_PLACEHOLDER = '{repo}/';

function attachmentUrlPrefix(repo) {
  return `https://github.com/${repo}/raw/HEAD/`;
}

export function compressAttachmentLinks(bodyText, repo) {
  if (!repo) return String(bodyText || '');
  return String(bodyText || '').split(attachmentUrlPrefix(repo)).join(ATTACHMENT_LINK_PLACEHOLDER);
}

export function expandAttachmentLinks(bodyText, repo) {
  if (!repo) return String(bodyText || '');
  return String(bodyText || '').split(ATTACHMENT_LINK_PLACEHOLDER).join(attachmentUrlPrefix(repo));
}
