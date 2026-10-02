import { describe, expect, it } from 'vitest';
import {
  appendVoiceAttachmentLink,
  composeVoiceIssue,
  knownTagNames,
  normalizeSuggestedTitle,
  normalizeVoiceParagraphs,
  voiceAttachmentLink,
  voiceAudioFile
} from './voice-notes.js';

describe('전사문 정리', () => {
  it('줄바꿈을 문단 단위로 맞추고 앞뒤 공백을 없앤다', () => {
    expect(normalizeVoiceParagraphs('\r\n첫 문단\r\n둘째\n\n\n셋째\n')).toBe('첫 문단\n\n둘째\n\n셋째');
    expect(normalizeVoiceParagraphs(null)).toBe('');
  });

  it('제안 제목을 한 줄 50자로 줄인다', () => {
    expect(normalizeSuggestedTitle('  회의\n  메모  ')).toBe('회의 메모');
    expect(normalizeSuggestedTitle('가'.repeat(60))).toHaveLength(50);
    expect(normalizeSuggestedTitle(undefined)).toBe('');
  });

  it('저장소에 있는 태그만 남긴다', () => {
    expect(knownTagNames(['Work', '없는 태그', 'home'], [{ name: 'work' }, { name: 'home' }])).toEqual(['Work', 'home']);
  });
});

describe('composeVoiceIssue', () => {
  it('첫 줄 제목 방식이면 제안 제목을 본문 첫 줄로 넣는다', () => {
    expect(composeVoiceIssue({ titleMode: 'first-line', body: '본문', suggestedTitle: '제목' }))
      .toEqual({ title: '제목', body: '제목\n\n본문' });
  });

  it('첫 줄 제목 방식에서 제안 제목이 없으면 본문 첫 줄이 제목이다', () => {
    expect(composeVoiceIssue({ titleMode: 'first-line', body: '첫 줄\n\n둘째', suggestedTitle: '' }))
      .toEqual({ title: '첫 줄', body: '첫 줄\n\n둘째' });
  });

  it('별도 제목 방식이면 제안 제목을 제목으로만 쓴다', () => {
    expect(composeVoiceIssue({ titleMode: 'separate', body: '본문', suggestedTitle: '제목' }))
      .toEqual({ title: '제목', body: '본문' });
    expect(composeVoiceIssue({ titleMode: 'separate', body: '본문 첫 줄', suggestedTitle: '' }).title).toBe('본문 첫 줄');
  });

  it('본문도 제목도 없으면 기본 제목을 붙인다', () => {
    expect(composeVoiceIssue({ titleMode: 'separate', body: '', suggestedTitle: '' }).title).toBe('음성 기록');
    expect(composeVoiceIssue({ titleMode: 'first-line', body: '', suggestedTitle: '제목' }))
      .toEqual({ title: '음성 기록', body: '' });
  });
});

describe('원본 음성 첨부', () => {
  it('녹음 형식에 맞는 확장자와 시각으로 파일 이름을 만든다', () => {
    const now = new Date('2026-09-19T01:02:03.456Z');
    const webm = voiceAudioFile(new Blob(['a'], { type: 'audio/webm;codecs=opus' }), now);
    expect(webm.name).toBe('voice-2026-09-19T01-02-03-456Z.webm');
    expect(webm.type).toBe('audio/webm;codecs=opus');
    expect(voiceAudioFile(new Blob(['a'], { type: 'audio/mp4' }), now).name).toMatch(/\.mp4$/);
    expect(voiceAudioFile(new Blob(['a']), now).type).toBe('audio/webm');
  });

  it('첨부가 있을 때만 재생 링크를 붙인다', () => {
    const attachment = { path: '.issue-note-assets/issues/3/voice.webm' };
    const link = voiceAttachmentLink('octo/notes', attachment);
    expect(link).toMatch(/^<audio controls preload="metadata" src="[^"]+voice\.webm">/);
    expect(appendVoiceAttachmentLink('본문', 'octo/notes', attachment)).toBe(`본문\n\n${link}`);
    expect(appendVoiceAttachmentLink('본문', 'octo/notes', null)).toBe('본문');
    expect(voiceAttachmentLink('octo/notes', null)).toBe('');
  });
});
