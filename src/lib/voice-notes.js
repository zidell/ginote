import { attachmentRawUrl } from './attachments.js';
import { automaticTitle } from './notes.js';

const SUGGESTED_TITLE_MAX_LENGTH = 50;
const FALLBACK_TITLE = '음성 기록';

// 전사문의 줄바꿈을 문단 단위로 맞춘다.
export function normalizeVoiceParagraphs(body) {
  return String(body || '').replace(/\r\n?/g, '\n').replace(/\n+/g, '\n\n').trim();
}

export function normalizeSuggestedTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().slice(0, SUGGESTED_TITLE_MAX_LENGTH);
}

// 정제 모델이 고른 태그 중 저장소에 실제로 있는 것만 남긴다.
export function knownTagNames(selectedTags, labels) {
  return selectedTags.filter((name) => labels.some(
    (label) => label.name.toLocaleLowerCase() === String(name).toLocaleLowerCase()
  ));
}

// 음성으로 새 노트를 만들 때의 제목과 본문이다. 첫 줄 제목 방식이면 제안 제목을 본문 첫 줄로 넣는다.
export function composeVoiceIssue({ titleMode, body, suggestedTitle }) {
  const issueBody = titleMode === 'first-line' && body && suggestedTitle
    ? `${suggestedTitle}\n\n${body}`
    : body;
  const title = titleMode === 'separate'
    ? suggestedTitle || automaticTitle(body) || FALLBACK_TITLE
    : automaticTitle(issueBody) || FALLBACK_TITLE;
  return { title, body: issueBody };
}

export function voiceAudioFile(audio, now = new Date()) {
  const extension = audio.type.includes('mp4') ? 'mp4' : 'webm';
  return new File(
    [audio],
    `voice-${now.toISOString().replace(/[:.]/g, '-')}.${extension}`,
    { type: audio.type || 'audio/webm' }
  );
}

export function voiceAttachmentLink(repo, attachment) {
  if (!attachment) return '';
  const url = attachmentRawUrl(repo, attachment.path);
  return `<audio controls preload="metadata" src="${url}"><a href="${url}">🎙 원본 음성 다운로드</a></audio>`;
}

export function appendVoiceAttachmentLink(body, repo, attachment) {
  const link = voiceAttachmentLink(repo, attachment);
  return link ? `${body}\n\n${link}` : body;
}
