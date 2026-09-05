import { describe, expect, it } from 'vitest';
import {
  automaticTitle,
  firstLinePreview,
  linkAtCursor,
  normalizeTagName,
  markdownToPlainText,
  shortenMiddle
} from './notes.js';

describe('automaticTitle', () => {
  it('첫 줄의 앞뒤 공백을 제거해 제목으로 사용한다', () => {
    expect(automaticTitle('  첫 줄이 제목  \n두 번째 줄')).toBe('첫 줄이 제목');
  });

  it('기본값으로 첫 줄을 50자까지 자른다', () => {
    expect(automaticTitle('가'.repeat(60))).toBe('가'.repeat(50));
  });

  it('이모지를 잘못된 UTF-16 문자로 나누지 않는다', () => {
    const title = automaticTitle('📝'.repeat(51));
    expect(Array.from(title)).toHaveLength(50);
    expect(title).toBe('📝'.repeat(50));
  });

  it('빈 본문에는 빈 제목을 반환한다', () => {
    expect(automaticTitle(null)).toBe('');
    expect(automaticTitle('   \n두 번째 줄')).toBe('');
  });
});

describe('markdownToPlainText', () => {
  it('목록용 텍스트에서 Markdown 문법을 제거한다', () => {
    expect(markdownToPlainText('# **제목**\n- [x] [링크](https://example.com)와 `코드`'))
      .toBe('제목 링크와 코드');
  });

  it('이미지는 주소 대신 대체 텍스트만 남긴다', () => {
    expect(markdownToPlainText('![풍경](https://example.com/image.png) 다음 문장'))
      .toBe('풍경 다음 문장');
  });
});

describe('linkAtCursor', () => {
  it('Markdown 링크의 라벨과 주소 위에서 URL을 찾는다', () => {
    const body = '앞 [GitHub](https://github.com/example/repo) 뒤';
    expect(linkAtCursor(body, body.indexOf('GitHub') + 2)?.url)
      .toBe('https://github.com/example/repo');
    expect(linkAtCursor(body, body.indexOf('github.com') + 3)?.url)
      .toBe('https://github.com/example/repo');
  });

  it('일반 URL에서 문장 끝 문장부호를 제외한다', () => {
    const body = '문서: https://example.com/guide?q=note.';
    expect(linkAtCursor(body, body.indexOf('example.com'))).toEqual({
      url: 'https://example.com/guide?q=note',
      start: 4,
      end: 36
    });
  });

  it('이미지 문법이나 링크 밖의 커서는 무시한다', () => {
    const body = '![사진](https://example.com/a.png) 일반 텍스트';
    expect(linkAtCursor(body, 3)).toBeNull();
    expect(linkAtCursor(body, body.length)).toBeNull();
  });
});

describe('shortenMiddle', () => {
  it('긴 주소의 가운데만 줄인다', () => {
    expect(shortenMiddle('1234567890', 7)).toBe('123…890');
  });

  it('짧은 주소는 그대로 둔다', () => {
    expect(shortenMiddle('https://example.com', 30)).toBe('https://example.com');
  });
});

describe('firstLinePreview', () => {
  it('첫 줄만 Markdown 없이 최대 50자로 표시한다', () => {
    expect(firstLinePreview(`**${'가'.repeat(60)}**\n둘째 줄`)).toBe('가'.repeat(50));
  });

  it('짧은 첫 줄을 임의로 늘리지 않는다', () => {
    expect(firstLinePreview('한\n아주 긴 둘째 줄')).toBe('한');
  });
});

describe('normalizeTagName', () => {
  it('앞의 #과 공백을 정리해 태그 이름을 만든다', () => {
    expect(normalizeTagName('  ##일간 기록 ')).toBe('일간-기록');
  });

  it('50자를 넘는 이름은 잘라낸다', () => {
    expect(normalizeTagName('가'.repeat(60))).toBe('가'.repeat(50));
  });

  it('빈 값은 빈 문자열로 둔다', () => {
    expect(normalizeTagName('  #  ')).toBe('');
  });
});
