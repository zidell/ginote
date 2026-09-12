import { describe, expect, it } from 'vitest';
import {
  composeAttachmentLink,
  compressAttachmentLinks,
  expandAttachmentLinks,
  insertAttachmentLinks,
  managedAttachmentLinks,
  parseAttachmentPaths,
  removeAttachmentLink,
  stripManagedAttachmentBlocks,
  withManagedAttachmentBlock
} from './attachments.js';

const imageAttachment = {
  name: '여행 사진 [1].png',
  type: 'image/png',
  path: '.issue-note-assets/issues/31/id-여행 사진.png',
  sha: 'abc123',
  size: 2048
};

describe('attachment link 본문 삽입', () => {
  it('이미지는 미리보기 이미지 링크로 만든다', () => {
    const link = composeAttachmentLink('owner/private-notes', imageAttachment);

    expect(link).toContain('![](');
    expect(link).toContain('owner/private-notes/raw/HEAD/');
    expect(link).toContain('%EC%97%AC%ED%96%89%20%EC%82%AC%EC%A7%84.png');
  });

  it('일반 파일은 링크로 표시한다', () => {
    const link = composeAttachmentLink('owner/repo', {
      ...imageAttachment,
      name: 'plan.pdf',
      type: 'application/pdf'
    });

    expect(link).toContain('[](');
    expect(link).not.toContain('plan.pdf](');
    expect(link).not.toContain('![plan.pdf](');
  });

  it('본문에 있는 첨부 링크들의 경로를 순서대로 추출한다', () => {
    const first = composeAttachmentLink('owner/repo', imageAttachment);
    const second = composeAttachmentLink('owner/repo', {
      ...imageAttachment,
      name: 'plan.pdf',
      type: 'application/pdf',
      path: '.issue-note-assets/issues/31/id2-plan.pdf'
    });
    const body = `노트 내용\n\n${first}\n\n중간 문장\n\n${second}\n`;

    expect(parseAttachmentPaths(body)).toEqual([
      imageAttachment.path,
      '.issue-note-assets/issues/31/id2-plan.pdf'
    ]);
  });

  it('첨부 raw 링크가 아닌 일반 링크는 무시한다', () => {
    const body = '내용 [문서](https://example.com/doc) 및 ![그림](https://github.com/owner/repo/blob/main/pic.png)';
    expect(parseAttachmentPaths(body)).toEqual([]);
  });

  it('본문에서 첨부 링크를 제거하고 남은 빈 줄을 정리한다', () => {
    const link = composeAttachmentLink('owner/repo', imageAttachment);
    const body = `노트 내용\n\n${link}\n\n다음 문단`;

    expect(removeAttachmentLink(body, link)).toBe('노트 내용\n\n다음 문단');
  });

  it('제거할 링크가 본문에 없으면 그대로 반환한다', () => {
    const link = composeAttachmentLink('owner/repo', imageAttachment);
    expect(removeAttachmentLink('노트 내용', link)).toBe('노트 내용');
  });

  it('위치를 지정하지 않으면 본문 끝에 링크를 추가한다', () => {
    const link = composeAttachmentLink('owner/repo', imageAttachment);
    expect(insertAttachmentLinks('노트 내용', [link])).toBe(`노트 내용\n\n${link}`);
  });

  it('빈 본문에 추가할 때는 앞뒤 빈 줄을 넣지 않는다', () => {
    const link = composeAttachmentLink('owner/repo', imageAttachment);
    expect(insertAttachmentLinks('', [link])).toBe(link);
  });

  it('커서 위치에 링크를 끼워 넣고 앞뒤 문단과 빈 줄로 구분한다', () => {
    const link = composeAttachmentLink('owner/repo', imageAttachment);
    const body = '앞 문단내용\n뒤 문단내용';
    const cursor = body.indexOf('\n뒤');

    expect(insertAttachmentLinks(body, [link], cursor)).toBe(
      `앞 문단내용\n\n${link}\n\n뒤 문단내용`
    );
  });

  it('여러 링크를 한 번에 넣을 때는 링크끼리도 빈 줄로 구분한다', () => {
    const first = composeAttachmentLink('owner/repo', imageAttachment);
    const second = composeAttachmentLink('owner/repo', {
      ...imageAttachment,
      name: 'plan.pdf',
      type: 'application/pdf',
      path: '.issue-note-assets/issues/31/id2-plan.pdf'
    });

    expect(insertAttachmentLinks('', [first, second])).toBe(`${first}\n\n${second}`);
  });

  it('편집기에서는 저장소 주소를 {repo}로 압축해 보여준다', () => {
    const link = composeAttachmentLink('owner/repo', imageAttachment);
    const body = `노트 내용\n\n${link}`;

    const compressed = compressAttachmentLinks(body, 'owner/repo');

    expect(compressed).not.toContain('https://github.com/owner/repo/raw/HEAD/');
    expect(compressed).toContain('{repo}/');
  });

  it('저장 직전에는 압축된 주소를 다시 실제 GitHub 주소로 펼친다', () => {
    const link = composeAttachmentLink('owner/repo', imageAttachment);
    const body = `노트 내용\n\n${link}`;

    const roundTripped = expandAttachmentLinks(compressAttachmentLinks(body, 'owner/repo'), 'owner/repo');

    expect(roundTripped).toBe(body);
  });

  it('자동 첨부 블록은 본문 맨 위에 주석 경계와 함께 만든다', () => {
    const link = composeAttachmentLink('owner/repo', imageAttachment);

    expect(withManagedAttachmentBlock('사용자 본문', [link])).toBe(
      `<!-- ginote:attachments:start -->\n\n${link}\n\n<!-- ginote:attachments:end -->\n\n사용자 본문`
    );
  });

  it('자동 첨부 블록만 편집기 본문에서 제거하고 수동 링크는 유지한다', () => {
    const automatic = composeAttachmentLink('owner/repo', imageAttachment);
    const manual = composeAttachmentLink('owner/repo', {
      ...imageAttachment,
      path: '.issue-note-assets/issues/31/id2-plan.pdf',
      name: 'plan.pdf',
      type: 'application/pdf'
    });
    const remoteBody = withManagedAttachmentBlock(`사용자 본문\n\n${manual}`, [automatic]);

    expect(stripManagedAttachmentBlocks(remoteBody)).toBe(`사용자 본문\n\n${manual}`);
    expect(managedAttachmentLinks(remoteBody)).toEqual([automatic]);
  });

  it('새 자동 블록을 저장할 때 이전 자동 블록은 중복하지 않는다', () => {
    const first = composeAttachmentLink('owner/repo', imageAttachment);
    const second = composeAttachmentLink('owner/repo', {
      ...imageAttachment,
      path: '.issue-note-assets/issues/31/id2-plan.pdf',
      name: 'plan.pdf',
      type: 'application/pdf'
    });
    const once = withManagedAttachmentBlock('본문', [first]);
    const updated = withManagedAttachmentBlock(once, [second]);

    expect(updated).not.toContain(first);
    expect(updated).toContain(second);
    expect(updated.match(/ginote:attachments:start/g)).toHaveLength(1);
  });
});
