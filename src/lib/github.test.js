import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeAttachmentComment } from './attachments.js';
import { setAppLocale } from './i18n.js';
import {
  createIssue,
  createLabel,
  deleteAttachment,
  getIssue,
  listIssueAttachmentComments,
  listIssueAttachmentFiles,
  listExpiredClosedIssues,
  listIssues,
  listIssuesPage,
  purgeIssueAttachments,
  renameLabel,
  searchIssues,
  searchIssuesPage,
  updateIssue,
  uploadAttachment,
  verifyConnection
} from './github.js';

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function attachmentComment(id, issueNumber, name = `${id}.png`) {
  const attachment = {
    name,
    type: 'image/png',
    path: `.issue-note-assets/issues/${issueNumber}/${name}`,
    sha: `sha-${id}`,
    size: id
  };
  return {
    id,
    html_url: `https://github.com/owner/repo/issues/${issueNumber}#issuecomment-${id}`,
    body: composeAttachmentComment('owner/repo', attachment)
  };
}

describe('GitHub API client', () => {
  beforeEach(() => {
    // 오류 문구는 앱 locale을 따르므로, 실행 환경의 시스템 언어와 무관하게 고정한다.
    setAppLocale('en');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('저장소 URL을 owner/repository 형식으로 정규화해 연결한다', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ login: 'tester' }))
      .mockResolvedValueOnce(jsonResponse({ full_name: 'owner/repo' }));

    await expect(
      verifyConnection('secret-token', ' https://github.com/owner/repo.git ')
    ).resolves.toEqual({
      user: { login: 'tester' },
      repository: { full_name: 'owner/repo' },
      repo: 'owner/repo'
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/user');
    expect(fetch.mock.calls[1][0]).toBe('https://api.github.com/repos/owner/repo');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-token');
  });

  it('열린 이슈를 최근 순 30개로 요청하고 pull request를 제외한다', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse([
        { id: 1, number: 10, title: '노트' },
        { id: 2, number: 11, title: 'PR', pull_request: {} }
      ]))
      .mockResolvedValueOnce(jsonResponse({ total_count: 42, items: [] }));

    const result = await listIssues('token', 'owner/repo', 'open', '여행 계획');
    const url = new URL(fetch.mock.calls[0][0]);

    expect(result).toEqual([{ id: 1, number: 10, title: '노트' }]);
    expect(url.pathname).toBe('/repos/owner/repo/issues');
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('q')).toBe(
      'repo:owner/repo is:issue is:open label:"여행 계획"'
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: '30',
      page: '1',
      labels: '여행 계획'
    });
  });

  it('닫힌 이슈는 최근 30일 이내만 검색한다', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      total_count: 3,
      items: [
        { id: 1, number: 10, title: '먼저 삭제한 노트', closed_at: '2026-09-04T10:00:00Z' },
        { id: 2, number: 11, title: '최근 삭제한 노트', closed_at: '2026-09-04T11:00:00Z' },
        { id: 3, number: 12, title: 'PR', closed_at: '2026-09-04T12:00:00Z', pull_request: {} }
      ]
    }));

    const result = await listIssuesPage(
      'token',
      'owner/repo',
      'closed',
      '여행 계획',
      1,
      new Date('2026-09-04T12:00:00Z')
    );
    const url = new URL(fetch.mock.calls[0][0]);

    expect(result).toEqual({
      items: [
        { id: 2, number: 11, title: '최근 삭제한 노트', closed_at: '2026-09-04T11:00:00Z' },
        { id: 1, number: 10, title: '먼저 삭제한 노트', closed_at: '2026-09-04T10:00:00Z' }
      ],
      hasMore: false,
      totalCount: 3
    });
    expect(url.pathname).toBe('/search/issues');
    expect(url.searchParams.get('q')).toBe(
      'repo:owner/repo is:issue is:closed closed:>=2026-08-05 label:"여행 계획"'
    );
  });

  it('이슈 목록의 다음 페이지 링크와 페이지 번호를 처리한다', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(
      [{ id: 31, number: 31, title: '다음 노트' }],
      { headers: { Link: '<https://api.github.com/repositories/1/issues?page=3>; rel="next"' } }
    ));

    const result = await listIssuesPage('token', 'owner/repo', 'open', '', 2);
    const url = new URL(fetch.mock.calls[0][0]);

    expect(url.searchParams.get('page')).toBe('2');
    expect(result.hasMore).toBe(true);
    expect(result.totalCount).toBeNull();
    expect(result.items).toHaveLength(1);
  });

  it('설정한 목록 단위를 per_page와 다음 페이지 계산에 사용한다', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      total_count: 41,
      items: Array.from({ length: 20 }, (_, index) => ({ id: index + 21 }))
    }));

    const result = await searchIssuesPage(
      'token', 'owner/repo', 'open', '검색어', '', 2, Date.now(), 20
    );
    const url = new URL(fetch.mock.calls[0][0]);

    expect(url.searchParams.get('per_page')).toBe('20');
    expect(result.hasMore).toBe(true);
  });

  it('제목과 본문을 대상으로 저장소와 태그를 포함해 검색한다', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 1, title: '결과' }, { id: 2, pull_request: {} }]
    }));

    const result = await searchIssues('token', 'owner/repo', 'open', '  검색어  ', '할 일');
    const url = new URL(fetch.mock.calls[0][0]);

    expect(result).toEqual([{ id: 1, title: '결과' }]);
    expect(url.pathname).toBe('/search/issues');
    expect(url.searchParams.get('q')).toBe(
      '검색어 repo:owner/repo is:issue is:open in:title,body label:"할 일"'
    );
    expect(url.searchParams.get('sort')).toBe('updated');
    expect(url.searchParams.get('per_page')).toBe('30');
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('검색 결과의 전체 개수로 다음 페이지 여부를 계산한다', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      total_count: 61,
      items: Array.from({ length: 30 }, (_, index) => ({ id: index + 31 }))
    }));

    const result = await searchIssuesPage('token', 'owner/repo', 'open', '검색어', '', 2);

    expect(result.items).toHaveLength(30);
    expect(result.hasMore).toBe(true);
    expect(result.totalCount).toBe(61);
  });

  it('30일이 지난 닫힌 이슈만 오래된 순서로 조회한다', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ items: [{ id: 1, number: 31 }] }));

    const result = await listExpiredClosedIssues('token', 'owner/repo', Date.UTC(2026, 8, 4));
    const url = new URL(fetch.mock.calls[0][0]);

    expect(result).toEqual([{ id: 1, number: 31 }]);
    expect(url.searchParams.get('q')).toBe('repo:owner/repo is:issue is:closed closed:<2026-08-05');
    expect(url.searchParams.get('sort')).toBe('updated');
    expect(url.searchParams.get('order')).toBe('asc');
    expect(url.searchParams.get('per_page')).toBe('100');
  });

  it('이슈 생성과 수정에 제목·본문·라벨만 전송한다', async () => {
    const note = { title: '제목', body: '본문', labels: ['개인'], ignored: true };
    fetch
      .mockResolvedValueOnce(jsonResponse({ id: 1, number: 31 }))
      .mockResolvedValueOnce(jsonResponse({ id: 1, number: 31, title: '제목' }));

    await createIssue('token', 'owner/repo', note);
    await updateIssue('token', 'owner/repo', 31, note, { keepalive: true });

    const [createUrl, createOptions] = fetch.mock.calls[0];
    const [updateUrl, updateOptions] = fetch.mock.calls[1];
    expect(createUrl).toBe('https://api.github.com/repos/owner/repo/issues');
    expect(createOptions.method).toBe('POST');
    expect(JSON.parse(createOptions.body)).toEqual({ title: '제목', body: '본문', labels: ['개인'] });
    expect(updateUrl).toBe('https://api.github.com/repos/owner/repo/issues/31');
    expect(updateOptions.method).toBe('PATCH');
    expect(updateOptions.keepalive).toBe(true);
  });

  it('GitHub 오류의 상태와 API 한도 정보를 유지한다', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(
      { message: 'API rate limit exceeded' },
      { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '12345' } }
    ));

    const request = getIssue('token', 'owner/repo', 31);
    await expect(request).rejects.toMatchObject({
      message: 'API rate limit exceeded',
      status: 403,
      remaining: '0',
      reset: '12345'
    });
  });

  it('라벨이 이미 있으면 422 후 기존 라벨을 다시 읽는다', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ message: 'Validation Failed' }, { status: 422 }))
      .mockResolvedValueOnce(jsonResponse({ id: 7, name: '여행 계획', color: '123456' }));

    await expect(createLabel('token', 'owner/repo', '여행 계획')).resolves.toMatchObject({ id: 7 });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      name: '여행 계획',
      color: expect.stringMatching(/^[0-9a-f]{6}$/)
    });
    expect(fetch.mock.calls[1][0]).toBe(
      'https://api.github.com/repos/owner/repo/labels/%EC%97%AC%ED%96%89%20%EA%B3%84%ED%9A%8D'
    );
  });

  it('라벨 이름을 바꿀 때 기존 색상은 변경하지 않는다', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ id: 7, name: '새 이름', color: '123456' }));

    await renameLabel('token', 'owner/repo', '기존 이름', '새 이름');

    expect(fetch.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/owner/repo/labels/%EA%B8%B0%EC%A1%B4%20%EC%9D%B4%EB%A6%84'
    );
    expect(fetch.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ new_name: '새 이름' });
  });

  it('Link 헤더가 없어도 100개인 댓글 페이지를 끝까지 읽는다', async () => {
    const firstPage = [
      attachmentComment(1, 31, 'first.png'),
      attachmentComment(2, 99, 'other-issue.png'),
      ...Array.from({ length: 98 }, (_, index) => ({ id: index + 10, body: '일반 댓글' }))
    ];
    const secondPage = [attachmentComment(3, 31, 'second.png')];
    fetch
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse(secondPage));

    const result = await listIssueAttachmentComments('token', 'owner/repo', 31);

    expect(result.map((item) => item.name)).toEqual(['first.png', 'second.png']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toContain('/issues/31/comments?per_page=100');
    expect(fetch.mock.calls[1][0]).toContain('/issues/31/comments?per_page=100&page=2');
  });

  it('댓글의 Link 헤더가 제공하는 다음 페이지를 따라간다', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse([], {
        headers: {
          link: '<https://api.github.com/repos/owner/repo/issues/31/comments?per_page=100&page=7>; rel="next"'
        }
      }))
      .mockResolvedValueOnce(jsonResponse([attachmentComment(7, 31, 'linked.png')]));

    const result = await listIssueAttachmentComments('token', 'owner/repo', 31);

    expect(result).toHaveLength(1);
    expect(fetch.mock.calls[1][0]).toContain('page=7');
  });

  it('첨부 폴더가 없으면 빈 목록으로 처리하고 하위 폴더를 제외한다', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse([
        { type: 'file', name: 'photo.png', path: '.issue-note-assets/issues/31/photo.png', sha: 'a', size: 10, html_url: 'file-url' },
        { type: 'dir', name: 'nested', path: '.issue-note-assets/issues/31/nested', sha: 'b' }
      ]));

    await expect(listIssueAttachmentFiles('token', 'owner/repo', 31)).resolves.toEqual([]);
    await expect(listIssueAttachmentFiles('token', 'owner/repo', 31)).resolves.toEqual([
      { name: 'photo.png', path: '.issue-note-assets/issues/31/photo.png', sha: 'a', size: 10, url: 'file-url' }
    ]);
  });

  it('첨부파일을 안전한 경로와 base64 내용으로 저장한다', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
    fetch.mockResolvedValueOnce(jsonResponse({
      content: { sha: 'stored-sha', size: 2, html_url: 'https://github.com/file' }
    }));
    const file = {
      name: '계획 #1?.txt',
      type: 'text/plain',
      arrayBuffer: async () => new Uint8Array([65, 66]).buffer
    };

    const result = await uploadAttachment('token', 'owner/repo', 31, file);
    const [url, options] = fetch.mock.calls[0];

    expect(result.path).toBe(
      '.issue-note-assets/issues/31/00000000-0000-4000-8000-000000000000-계획-1-.txt'
    );
    expect(decodeURIComponent(new URL(url).pathname)).toContain(result.path);
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toMatchObject({
      message: 'Add Ginote attachment: 계획 #1?.txt',
      content: 'QUI='
    });
  });

  it('첨부파일 삭제시 해당 SHA를 함께 전송한다', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ commit: { sha: 'commit-sha' } }));
    const attachment = {
      name: '여행 사진.png',
      path: '.issue-note-assets/issues/31/id-여행 사진.png',
      sha: 'file-sha'
    };

    await deleteAttachment('token', 'owner/repo', attachment);
    const [url, options] = fetch.mock.calls[0];

    expect(decodeURIComponent(new URL(url).pathname)).toContain(attachment.path);
    expect(options.method).toBe('DELETE');
    expect(JSON.parse(options.body)).toEqual({
      message: 'Delete Ginote attachment: 여행 사진.png',
      sha: 'file-sha'
    });
  });

  it('만료된 노트의 연결된 첨부와 고아 첨부를 함께 정리한다', async () => {
    const linked = attachmentComment(7, 31, 'linked.png');
    fetch
      .mockResolvedValueOnce(jsonResponse([linked]))
      .mockResolvedValueOnce(jsonResponse([
        { type: 'file', name: 'linked.png', path: '.issue-note-assets/issues/31/linked.png', sha: 'linked-sha', size: 7 },
        { type: 'file', name: 'orphan.png', path: '.issue-note-assets/issues/31/orphan.png', sha: 'orphan-sha', size: 8 }
      ]))
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: '1' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: '2' } }));

    await expect(purgeIssueAttachments('token', 'owner/repo', 31)).resolves.toEqual({
      deletedFiles: 2,
      deletedComments: 1
    });

    expect(fetch.mock.calls).toHaveLength(5);
    expect(fetch.mock.calls[2][1].method).toBe('DELETE');
    expect(fetch.mock.calls[3][0]).toContain('/issues/comments/7');
    expect(fetch.mock.calls[4][1].method).toBe('DELETE');
  });

  it('잘못된 저장소 형식은 fetch 전에 거부한다', async () => {
    await expect(listIssues('token', 'owner-only')).rejects.toThrow(
      'Enter the repository as owner/repository.'
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
