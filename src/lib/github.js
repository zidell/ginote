import { tagColorForName } from './colors.js';
import { translate } from './i18n.js';
import { parseRepositoryAddress } from './repo-address.js';
import { ATTACHMENT_BRANCH } from './attachments.js';

const API_ROOT = 'https://api.github.com';
export const DEFAULT_ISSUE_PAGE_SIZE = 30;
export const CLOSED_ISSUE_RETENTION_DAYS = 30;
const ATTACHMENT_STORAGE_MARKER = '.issue-note-assets/.ginote-storage';
const ATTACHMENT_STORAGE_MARKER_CONTENT = 'Ginote attachment storage. Do not delete this branch.\n';

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function request(path, token, options = {}) {
  const { withResponse = false, ...fetchOptions } = options;
  const response = await fetch(`${API_ROOT}${path}`, {
    cache: 'no-store',
    ...fetchOptions,
    headers: {
      ...headers(token),
      ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
      ...fetchOptions.headers
    }
  });

  if (!response.ok) {
    let message = '';
    try {
      const payload = await response.json();
      message = payload.message || '';
    } catch {
      // GitHub가 빈 응답을 보내는 경우 상태 문구를 사용한다.
    }

    const error = new Error(message || response.statusText || translate('errors.githubRequest'));
    error.status = response.status;
    error.remaining = response.headers.get('x-ratelimit-remaining');
    error.reset = response.headers.get('x-ratelimit-reset');
    throw error;
  }

  if (response.status === 204) return withResponse ? { data: null, response } : null;
  const data = await response.json();
  return withResponse ? { data, response } : data;
}

function nextPagePath(linkHeader) {
  const nextLink = String(linkHeader || '')
    .split(',')
    .find((link) => /rel="next"/.test(link));
  const url = nextLink?.match(/<([^>]+)>/)?.[1];
  if (!url) return '';
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function normalizeRepo(value) {
  const parsed = parseRepositoryAddress(value);
  if (!parsed) {
    throw new Error(translate('errors.repositoryFormat'));
  }
  return parsed.fullName;
}

function issueOnly(items) {
  return items.filter((item) => !item.pull_request);
}

function sortIssuesForState(items, state) {
  if (state !== 'closed') return items;
  return [...items].sort((a, b) => String(b.closed_at || '').localeCompare(String(a.closed_at || '')));
}

export async function verifyConnection(token, repoInput) {
  const repo = normalizeRepo(repoInput);
  const user = await request('/user', token);
  const repository = await request(`/repos/${repo}`, token);
  return { user, repository, repo };
}

export async function listIssues(token, repoInput, state = 'open', label = '') {
  const result = await listIssuesPage(token, repoInput, state, label);
  return result.items;
}

export async function listIssuesPage(token, repoInput, state = 'open', label = '', page = 1, now = Date.now(), pageSize = DEFAULT_ISSUE_PAGE_SIZE) {
  const repo = normalizeRepo(repoInput);
  if (state === 'closed') {
    return searchIssuesPage(token, repo, state, '', label, page, now, pageSize);
  }
  const params = new URLSearchParams({
    state,
    sort: 'updated',
    direction: 'desc',
    per_page: String(pageSize),
    page: String(page)
  });
  if (label) params.set('labels', label);
  const countQuery = `repo:${repo} is:issue is:${state}${label ? ` label:${JSON.stringify(label)}` : ''}`;
  const [pageResult, countResult] = await Promise.all([
    request(`/repos/${repo}/issues?${params}`, token, { withResponse: true }),
    page === 1
      ? request(`/search/issues?q=${encodeURIComponent(countQuery)}&per_page=1`, token)
      : null
  ]);
  const { data, response } = pageResult;
  return {
    items: issueOnly(data),
    hasMore: Boolean(nextPagePath(response.headers.get('link'))),
    totalCount: countResult ? Number(countResult.total_count) || 0 : null
  };
}

export async function searchIssues(token, repoInput, state, term, label = '') {
  const result = await searchIssuesPage(token, repoInput, state, term, label);
  return result.items;
}

export async function searchIssuesPage(token, repoInput, state, term, label = '', page = 1, now = Date.now(), pageSize = DEFAULT_ISSUE_PAGE_SIZE) {
  const repo = normalizeRepo(repoInput);
  const labelQuery = label ? ` label:${JSON.stringify(label)}` : '';
  const termQuery = term.trim();
  const cutoffQuery = state === 'closed'
    ? ` closed:>=${closedIssueCutoff(now)}`
    : '';
  const query = `${termQuery ? `${termQuery} ` : ''}repo:${repo} is:issue is:${state}${termQuery ? ' in:title,body' : ''}${cutoffQuery}${labelQuery}`;
  const data = await request(
    `/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${pageSize}&page=${page}`,
    token
  );
  return {
    items: sortIssuesForState(issueOnly(data.items), state),
    hasMore: page * pageSize < Math.min(Number(data.total_count) || 0, 1000),
    totalCount: Number(data.total_count) || 0
  };
}

export async function listExpiredClosedIssues(token, repoInput, now = Date.now(), pageSize = 100) {
  const repo = normalizeRepo(repoInput);
  const query = `repo:${repo} is:issue is:closed closed:<${closedIssueCutoff(now)}`;
  const data = await request(
    `/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=asc&per_page=${pageSize}&page=1`,
    token
  );
  return issueOnly(data.items);
}

function closedIssueCutoff(now) {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - CLOSED_ISSUE_RETENTION_DAYS);
  return cutoff.toISOString().slice(0, 10);
}

export function getIssue(token, repoInput, issueNumber) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/issues/${issueNumber}`, token);
}

export function createIssue(token, repoInput, note, requestOptions = {}) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/issues`, token, {
    ...requestOptions,
    method: 'POST',
    body: JSON.stringify({ title: note.title, body: note.body, labels: note.labels || [] })
  });
}

export function updateIssue(token, repoInput, issueNumber, note, requestOptions = {}) {
  const repo = normalizeRepo(repoInput);
  const payload = {
    title: note.title,
    body: note.body,
    labels: note.labels || []
  };
  if (note.state !== undefined) payload.state = note.state;
  return request(`/repos/${repo}/issues/${issueNumber}`, token, {
    ...requestOptions,
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function setIssueLabels(token, repoInput, issueNumber, labels) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/issues/${issueNumber}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ labels })
  });
}

export function addIssueLabel(token, repoInput, issueNumber, label) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/issues/${issueNumber}/labels`, token, {
    method: 'POST',
    body: JSON.stringify({ labels: [label] })
  });
}

export function removeIssueLabel(token, repoInput, issueNumber, label) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`, token, {
    method: 'DELETE'
  });
}

export async function listLabels(token, repoInput) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/labels?per_page=100`, token);
}

export async function createLabel(token, repoInput, name, requestOptions = {}) {
  const repo = normalizeRepo(repoInput);
  const { description = '', ...options } = requestOptions;
  try {
    return await request(`/repos/${repo}/labels`, token, {
      ...options,
      method: 'POST',
      body: JSON.stringify({ name, color: tagColorForName(name), ...(description ? { description } : {}) })
    });
  } catch (reason) {
    // 라벨 목록이 오래된 동안 다른 창에서 같은 라벨을 만든 경우 기존 라벨을 사용한다.
    if (reason?.status === 422) {
      return request(`/repos/${repo}/labels/${encodeURIComponent(name)}`, token);
    }
    throw reason;
  }
}

export async function renameLabel(token, repoInput, currentName, newName, description) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/labels/${encodeURIComponent(currentName)}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ new_name: newName, ...(description === undefined ? {} : { description }) })
  });
}

export async function removeLabel(token, repoInput, name) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/labels/${encodeURIComponent(name)}`, token, {
    method: 'DELETE'
  });
}

export function setIssueState(token, repoInput, issueNumber, state) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/issues/${issueNumber}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ state })
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function safeFileName(name) {
  return name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#%]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'attachment';
}

function issueAttachmentDirectory(issueNumber, commentId = null) {
  const normalizedNumber = Number(issueNumber);
  if (!Number.isInteger(normalizedNumber) || normalizedNumber <= 0) {
    throw new Error(translate('errors.issueNumberRequired'));
  }
  const directory = `.issue-note-assets/issues/${normalizedNumber}`;
  if (commentId === null || commentId === undefined) return directory;
  const normalizedCommentId = Number(commentId);
  if (!Number.isInteger(normalizedCommentId) || normalizedCommentId <= 0) {
    throw new Error('A comment ID is required for comment attachments.');
  }
  return `${directory}/comments/${normalizedCommentId}`;
}

async function attachmentBranchExists(token, repo) {
  try {
    await request(`/repos/${repo}/git/ref/heads/${ATTACHMENT_BRANCH}`, token);
    return true;
  } catch (reason) {
    if (reason?.status === 404 || reason?.status === 409) return false;
    throw reason;
  }
}

async function repositoryHasNoBranches(token, repo) {
  const repository = await request(`/repos/${repo}`, token);
  const defaultBranch = String(repository.default_branch || 'main');
  const encodedBranch = defaultBranch.split('/').map(encodeURIComponent).join('/');
  try {
    await request(`/repos/${repo}/git/ref/heads/${encodedBranch}`, token);
    return false;
  } catch (reason) {
    if (reason?.status === 404 || reason?.status === 409) return true;
    throw reason;
  }
}

async function createAttachmentBranchRef(token, repo, sha) {
  return request(`/repos/${repo}/git/refs`, token, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${ATTACHMENT_BRANCH}`,
      sha
    })
  });
}

async function ensureAttachmentBranch(token, repo) {
  if (await attachmentBranchExists(token, repo)) return;

  const tree = await request(`/repos/${repo}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify({
      tree: [{
        path: ATTACHMENT_STORAGE_MARKER,
        mode: '100644',
        type: 'blob',
        content: ATTACHMENT_STORAGE_MARKER_CONTENT
      }]
    })
  });
  const commit = await request(`/repos/${repo}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({
      message: 'Initialize Ginote attachment storage',
      tree: tree.sha,
      parents: []
    })
  });

  try {
    await createAttachmentBranchRef(token, repo, commit.sha);
  } catch (reason) {
    // 다른 창이 동시에 초기화한 경우 그 창이 만든 브랜치를 사용한다.
    if ((reason?.status === 409 || reason?.status === 422)
      && await attachmentBranchExists(token, repo)) return;

    // GitHub는 브랜치가 하나도 없는 빈 저장소에는 root commit ref도 만들지
    // 못하게 한다. 이 경우에만 marker로 기본 브랜치를 한 번 초기화한다. 빈
    // 저장소에는 실행할 workflow가 없으므로 CI를 깨우는 문제도 생기지 않는다.
    if (reason?.status === 422 && await repositoryHasNoBranches(token, repo)) {
      await request(`/repos/${repo}/contents/${ATTACHMENT_STORAGE_MARKER.split('/').map(encodeURIComponent).join('/')}`, token, {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Initialize empty repository for Ginote attachment storage',
          content: btoa(ATTACHMENT_STORAGE_MARKER_CONTENT)
        })
      });
      try {
        await createAttachmentBranchRef(token, repo, commit.sha);
        return;
      } catch (retryReason) {
        if ((retryReason?.status === 409 || retryReason?.status === 422)
          && await attachmentBranchExists(token, repo)) return;
        throw retryReason;
      }
    }
    throw reason;
  }
}

function attachmentContentsPath(repo, path) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ATTACHMENT_BRANCH)}`;
}

export async function uploadAttachment(token, repoInput, issueNumber, file, commentId = null) {
  const repo = normalizeRepo(repoInput);
  const unique = crypto.randomUUID();
  const path = `${issueAttachmentDirectory(issueNumber, commentId)}/${unique}-${safeFileName(file.name)}`;
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const content = arrayBufferToBase64(await file.arrayBuffer());

  await ensureAttachmentBranch(token, repo);

  const result = await request(`/repos/${repo}/contents/${encodedPath}`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Add Ginote attachment: ${file.name}`,
      content,
      branch: ATTACHMENT_BRANCH
    })
  });

  return {
    name: file.name,
    type: file.type,
    path,
    sha: result.content.sha,
    size: result.content.size,
    url: result.content.html_url
  };
}

export async function listIssueComments(token, repoInput, issueNumber) {
  const repo = normalizeRepo(repoInput);
  const comments = [];
  const visitedPages = new Set();
  let page = 1;
  let pagePath = `/repos/${repo}/issues/${issueNumber}/comments?per_page=100`;
  while (pagePath && !visitedPages.has(pagePath)) {
    visitedPages.add(pagePath);
    const { data: pageComments, response } = await request(pagePath, token, { withResponse: true });
    comments.push(
      ...pageComments.map((comment) => ({
        id: comment.id,
        body: comment.body || '',
        author: comment.user?.login || '',
        avatarUrl: comment.user?.avatar_url || '',
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        url: comment.html_url
      }))
    );
    const linkedNextPage = nextPagePath(response.headers.get('link'));
    page += 1;
    pagePath = linkedNextPage
      || (pageComments.length === 100
        ? `/repos/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`
        : '');
  }
  return comments;
}

export async function updateIssueComment(token, repoInput, commentId, body) {
  const repo = normalizeRepo(repoInput);
  const comment = await request(`/repos/${repo}/issues/comments/${commentId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ body })
  });
  return {
    id: comment.id,
    body: comment.body || '',
    author: comment.user?.login || '',
    avatarUrl: comment.user?.avatar_url || '',
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    url: comment.html_url
  };
}

export async function createIssueComment(token, repoInput, issueNumber, body) {
  const repo = normalizeRepo(repoInput);
  const comment = await request(`/repos/${repo}/issues/${issueNumber}/comments`, token, {
    method: 'POST',
    body: JSON.stringify({ body })
  });
  return {
    id: comment.id,
    body: comment.body || '',
    author: comment.user?.login || '',
    avatarUrl: comment.user?.avatar_url || '',
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    url: comment.html_url
  };
}

export async function deleteIssueComment(token, repoInput, commentId) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/issues/comments/${commentId}`, token, {
    method: 'DELETE'
  });
}

export async function listIssueAttachmentFiles(token, repoInput, issueNumber) {
  const repo = normalizeRepo(repoInput);
  await ensureAttachmentBranch(token, repo);
  const directory = issueAttachmentDirectory(issueNumber);
  return listAttachmentDirectory(token, repo, directory);
}

async function listAttachmentDirectory(token, repo, directory) {
  try {
    const result = await request(attachmentContentsPath(repo, directory), token);
    return Array.isArray(result)
      ? result.filter((item) => item.type === 'file').map((item) => ({
          name: item.name,
          path: item.path,
          sha: item.sha,
          size: item.size,
          url: item.html_url
        }))
      : [];
  } catch (reason) {
    if (reason?.status === 404) return [];
    throw reason;
  }
}

// 댓글 첨부는 본문 첨부와 별도 디렉터리에 보관한다. 목록도 소유 댓글 단위로
// 읽어야 본문 첨부 목록에 댓글 파일이 섞이지 않는다.
export async function listIssueCommentAttachmentFiles(token, repoInput, issueNumber, commentId) {
  const repo = normalizeRepo(repoInput);
  await ensureAttachmentBranch(token, repo);
  const directory = issueAttachmentDirectory(issueNumber, commentId);
  return listAttachmentDirectory(token, repo, directory);
}

// 보관 정리와 노트 병합에는 댓글 전용 하위 폴더까지 포함한 전체 목록이 필요하다.
export async function listAllIssueAttachmentFiles(token, repoInput, issueNumber) {
  const repo = normalizeRepo(repoInput);
  await ensureAttachmentBranch(token, repo);
  const rootDirectory = issueAttachmentDirectory(issueNumber);
  const visit = async (directory) => {
    try {
      const entries = await request(attachmentContentsPath(repo, directory), token);
      if (!Array.isArray(entries)) return [];
      const files = entries.filter((item) => item.type === 'file').map((item) => ({
        name: item.name, path: item.path, sha: item.sha, size: item.size, url: item.html_url
      }));
      const nested = await Promise.all(entries
        .filter((item) => item.type === 'dir')
        .map((item) => visit(item.path)));
      return [...files, ...nested.flat()];
    } catch (reason) {
      if (reason?.status === 404) return [];
      throw reason;
    }
  };
  return visit(rootDirectory);
}

export async function downloadAttachment(token, repoInput, attachment) {
  const repo = normalizeRepo(repoInput);
  const response = await fetch(`${API_ROOT}${attachmentContentsPath(repo, attachment.path)}`, {
    cache: 'no-store',
    headers: {
      ...headers(token),
      Accept: 'application/vnd.github.raw+json'
    }
  });

  if (!response.ok) {
    const error = new Error(response.statusText || translate('errors.attachmentLoad'));
    error.status = response.status;
    throw error;
  }
  // 일부 GitHub 응답 경로는 raw Accept를 받았어도 Contents JSON을 돌려준다.
  // 미디어 미리보기에는 JSON 문자열이 아니라 실제 파일 바이트가 필요하다.
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    if (typeof payload?.content === 'string' && payload.encoding === 'base64') {
      const binary = atob(payload.content.replace(/\s/g, ''));
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return new Blob([bytes]);
    }
  }
  return response.blob();
}

export async function deleteAttachment(token, repoInput, attachment) {
  const repo = normalizeRepo(repoInput);
  const encodedPath = attachment.path.split('/').map(encodeURIComponent).join('/');
  return request(`/repos/${repo}/contents/${encodedPath}`, token, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `Delete Ginote attachment: ${attachment.name}`,
      sha: attachment.sha,
      branch: ATTACHMENT_BRANCH
    })
  });
}

export async function purgeIssueAttachments(token, repoInput, issueNumber) {
  const files = await listAllIssueAttachmentFiles(token, repoInput, issueNumber);
  for (const file of files) {
    await deleteAttachment(token, repoInput, file);
  }
  return { deletedFiles: files.length };
}
