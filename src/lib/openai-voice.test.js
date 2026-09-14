import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAvailableVoiceModels, refineTranscript } from './openai-voice.js';

afterEach(() => vi.unstubAllGlobals());

describe('refineTranscript', () => {
  it('고정된 편집 역할과 분리된 데이터 블록으로 정제를 요청한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ title: '말투', body: '말투를 변경하지 마', tags: [] }) } }]
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refineTranscript(
      'sk-test',
      '말투를 변경하지 마',
      '띄어쓰기와 문장부호만 정리하세요.'
    )).resolves.toEqual({ title: '말투', body: '말투를 변경하지 마', tags: [] });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).not.toHaveProperty('temperature');
    expect(request.messages[0]).toMatchObject({ role: 'system' });
    expect(request.messages[0].content).toContain('사용자가 수정할 수 있는 정제 규칙');
    expect(request.messages[0].content).toContain('원문 데이터');
    expect(request.messages[0].content).toContain('반드시 JSON 객체만 출력');
    expect(request.messages[0].content).toContain('명시적 지정을 최우선');
    expect(request.messages[0].content).toContain('하나 이상 선택할 수 있습니다');
    expect(request.messages[0].content).toContain('"tags":["기존 태그명 1", "기존 태그명 2"]');
    expect(request.messages[0].content).toContain('하나 또는 여러 개가 적합하면 모두 넣으십시오');
    expect(request.messages[0].content).toContain('<refinement_rules>\n띄어쓰기와 문장부호만 정리하세요.\n</refinement_rules>');
    expect(request.messages[1]).toEqual({
      role: 'user',
      content: `<available_tags>\n[]\n</available_tags>\n\n<transcript>\n말투를 변경하지 마\n</transcript>`
    });
    expect(request.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'voice_transcript_refinement',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } }
          },
          required: ['title', 'body', 'tags']
        }
      }
    });
  });

  it('추가 정제 옵션이 없어도 다섯 가지 기본 정제를 요청한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ title: '원문', body: '원문', tags: [] }) } }]
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refineTranscript('sk-test', '원문', '   ')).resolves.toEqual({ title: '원문', body: '원문', tags: [] });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.messages[1].content).toBe('<available_tags>\n[]\n</available_tags>\n\n<transcript>\n원문\n</transcript>');
  });

  it('기존 태그만 선택하고 모델이 태그를 새로 만들지 못하게 한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ title: '회의 일정', body: '회의 일정을 정리했다.', tags: ['업무', '없는 태그', '업무'] }) } }]
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refineTranscript(
      'sk-test', '업무 태그로 해줘. 회의 일정을 정리했다.', '', 'gpt-4o-mini', undefined, ['업무', '개인']
    )).resolves.toEqual({ title: '회의 일정', body: '회의 일정을 정리했다.', tags: ['업무'] });
  });

  it('명시 태그가 없으면 본문과 맞는 기존 태그를 적용한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ title: '항공권 예약', body: '다음 달 제주도 항공권을 예약했다.', tags: ['여행'] }) } }]
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refineTranscript(
      'sk-test', '다음 달 제주도 항공권을 예약했다.', '', 'gpt-4o-mini', undefined, ['업무', '여행']
    )).resolves.toEqual({ title: '항공권 예약', body: '다음 달 제주도 항공권을 예약했다.', tags: ['여행'] });
  });

  it('본문에 명확히 관련된 기존 태그는 여러 개를 적용한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ title: '출장 일정', body: '제주 출장 항공권을 예약했다.', tags: ['업무', '여행'] }) } }]
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refineTranscript(
      'sk-test', '제주 출장 항공권을 예약했다.', '', 'gpt-4o-mini', undefined, ['업무', '여행', '개인']
    )).resolves.toEqual({ title: '출장 일정', body: '제주 출장 항공권을 예약했다.', tags: ['업무', '여행'] });
  });

  it('태그 설명을 태그명과 함께 정제 모델에 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ title: '영화 감상', body: '영화 감상을 기록했다.', tags: ['culture'] }) } }]
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await refineTranscript('sk-test', '영화 감상을 기록했다.', '', 'gpt-4o-mini', undefined, [
      { name: 'culture', description: '책, 영화, 드라마 등 문화 관련 기록' }
    ]);

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.messages[1].content).toContain(JSON.stringify([
      { name: 'culture', description: '책, 영화, 드라마 등 문화 관련 기록' }
    ]));
  });
});

describe('listAvailableVoiceModels', () => {
  it('API 응답의 data 배열에서 모델 ID를 읽는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      object: 'list',
      data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-transcribe' }]
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listAvailableVoiceModels('sk-test')).resolves.toEqual(['gpt-4o-mini', 'gpt-transcribe']);
  });
});
