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
    expect(request.messages[0].content).toContain('<refinement_rules>\n띄어쓰기와 문장부호만 정리하세요.\n</refinement_rules>');
    expect(request.messages[1]).toEqual({
      role: 'user',
      content: `<available_tags>\n[]\n</available_tags>\n\n<transcript>\n말투를 변경하지 마\n</transcript>`
    });
    expect(request.response_format).toEqual({ type: 'json_object' });
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
