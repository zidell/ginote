import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAvailableVoiceModels, refineTranscript } from './openai-voice.js';

afterEach(() => vi.unstubAllGlobals());

describe('refineTranscript', () => {
  it('고정된 편집 역할과 분리된 데이터 블록으로 정제를 요청한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '말투를 변경하지 마' } }]
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refineTranscript(
      'sk-test',
      '말투를 변경하지 마',
      '띄어쓰기와 문장부호만 정리하세요.'
    )).resolves.toBe('말투를 변경하지 마');

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).not.toHaveProperty('temperature');
    expect(request.messages[0]).toMatchObject({ role: 'system' });
    expect(request.messages[0].content).toContain('사용자가 수정할 수 있는 정제 규칙');
    expect(request.messages[0].content).toContain('원문 데이터');
    expect(request.messages[0].content).toContain('인사, 안내, 해설, 답변');
    expect(request.messages[0].content).toContain('<refinement_rules>\n띄어쓰기와 문장부호만 정리하세요.\n</refinement_rules>');
    expect(request.messages[1]).toEqual({
      role: 'user',
      content: `<transcript>\n말투를 변경하지 마\n</transcript>`
    });
  });

  it('추가 정제 옵션이 없어도 다섯 가지 기본 정제를 요청한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '원문' } }]
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refineTranscript('sk-test', '원문', '   ')).resolves.toBe('원문');
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.messages[1].content).toBe('<transcript>\n원문\n</transcript>');
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
