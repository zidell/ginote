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

const ATTACHMENT_LINK_PLACEHOLDER = '{repo}/';

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
