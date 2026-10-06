// web.json을 만든다. 저장소 루트에서 `node tui/internal/voice/testdata/gen.mjs`로 실행한다.
// 원본 JS 함수(src/lib의 음성 모듈과 NoteEditor.svelte의 음성 도우미)를 그대로 실행해 Go 테스트의
// 기대값을 얻는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as settings from '../../../../src/lib/voice-settings.js';
import * as legacy from '../../../../src/lib/voice-refinement-legacy-prompts.js';
import * as voiceNotes from '../../../../src/lib/voice-notes.js';
import { listAvailableVoiceModels, refineTranscript, transcribeAudio } from '../../../../src/lib/openai-voice.js';

const out = {};
let captured;
function respond(payload, status = 200) {
  globalThis.fetch = async (url, init = {}) => {
    captured = { url, method: init.method || 'GET', headers: init.headers, body: init.body };
    return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
      status, headers: { 'Content-Type': 'application/json' }
    });
  };
}
async function settle(promise) {
  try { return { value: await promise }; } catch (error) { return { error: error.message }; }
}

// 정제 요청 본문
const tagSets = [
  [],
  ['업무', ' 개인 ', '', '업무', 'WORK', 'work'],
  [{ name: 'culture', description: '책, 영화, 드라마 등 문화 관련 기록' }, { name: ' 여행 ', description: '  ' }, { name: '<b>&"\\', description: 'line\nbreak\t\u0001 ' }]
];
out.refineRequests = [];
for (const [transcript, prompt, model, tags] of [
  ['말투를 변경하지 마', '띄어쓰기와 문장부호만 정리하세요.', 'gpt-5.6-luna', tagSets[0]],
  ['원문', '   ', 'gpt-4o-mini', tagSets[1]],
  ['  <transcript>"인용"\n줄바꿈 & 기호  ', '\n규칙\n', 'm', tagSets[2]]
]) {
  respond({ choices: [{ message: { content: '{}' } }] });
  await refineTranscript('sk-test', transcript, prompt, model, undefined, tags);
  out.refineRequests.push({
    transcript, prompt, model,
    tags: tags.map((tag) => (typeof tag === 'object' ? tag : { name: tag, description: '' })),
    url: captured.url, method: captured.method, headers: captured.headers, body: captured.body
  });
}

// 정제 응답 해석
const parseTags = ['업무', '개인', 'Σίσυφος', { name: 'culture', description: 'x' }];
out.refineResponses = [];
for (const [transcript, payload] of [
  ['전사', { choices: [{ message: { content: JSON.stringify({ title: '회의 일정', body: '회의 일정을 정리했다.', tags: ['업무', '없는 태그', '업무', 'CULTURE', 'σίσυφοσ'] }) } }] }],
  ['전사', { choices: [{ message: { content: JSON.stringify({ title: '  긴\n\t제목 ' + '가'.repeat(60), body: '  본문  ', tags: '업무' }) } }] }],
  ['전사', { choices: [{ message: { content: JSON.stringify({ title: '제목', body: '   ', tags: ['업무'] }) } }] }],
  ['전사', { choices: [{ message: { content: JSON.stringify({ title: 3, body: '본문', tags: [1, null, '개인'] }) } }] }],
  ['전사', { choices: [{ message: { content: JSON.stringify({ title: '제목', body: 5 }) } }] }],
  ['전사', { choices: [{ message: { content: '  그냥 텍스트  ' } }] }],
  ['전사', { choices: [{ message: { content: '"문자열"' } }] }],
  ['전사', { choices: [{ message: { content: '[1,2]' } }] }],
  ['  전사문 그대로  ', { choices: [] }],
  ['  전사문 그대로  ', {}],
  ['전사', { choices: [{ message: { content: '' } }] }]
]) {
  respond(payload);
  out.refineResponses.push({ transcript, tags: parseTags.map((tag) => (typeof tag === 'object' ? tag : { name: tag, description: '' })), payload, result: await refineTranscript('k', transcript, '', 'm', undefined, parseTags) });
}

// 전사 요청
out.transcribeRequests = [];
for (const [type, model, language, hints, payload] of [
  ['audio/webm;codecs=opus', 'gpt-transcribe', 'zh-CN', 'Ginote, 지델', { text: '  你好  ' }],
  ['audio/mp4', 'whisper-1', ' KO ', '   ', { text: '안녕' }],
  ['', '', undefined, '', { text: null }],
  ['audio/ogg', 'm', 'en-US-x', '\n단어\n', { other: 1 }]
]) {
  respond(payload);
  const blob = new Blob(['audio-bytes'], { type });
  const value = await transcribeAudio('sk-test', blob, model, undefined, language, hints);
  const fields = [];
  for (const [name, entry] of captured.body.entries()) {
    fields.push(typeof entry === 'string' ? { name, value: entry } : { name, filename: entry.name, type: entry.type, value: await entry.text() });
  }
  out.transcribeRequests.push({ type, model, language: language ?? '', hints, payload, url: captured.url, method: captured.method, headers: captured.headers, fields, result: value });
}

// 모델 목록과 오류
out.listModels = [];
for (const payload of [
  { object: 'list', data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-transcribe' }, { id: '' }, {}, null, { id: 0 }, { id: 7 }] },
  { data: 'x' },
  {}
]) {
  respond(payload);
  out.listModels.push({ payload, result: await listAvailableVoiceModels('sk-test') });
}
out.errors = [];
for (const [status, body] of [
  [401, { error: { message: 'Incorrect API key provided' } }],
  [500, { error: {} }],
  [429, 'not json'],
  [400, { error: { message: '' } }]
]) {
  respond(body, status);
  out.errors.push({ status, body: typeof body === 'string' ? body : JSON.stringify(body), result: await settle(listAvailableVoiceModels('k')) });
}

// 설정
const legacyAll = [...legacy.SUPERSEDED_TYPO_PROMPTS, ...legacy.SUPERSEDED_WRITTEN_PROMPTS, ...legacy.SUPERSEDED_CONCLUSION_PROMPTS];
out.upgrade = ['', '   ', '  직접 쓴 규칙  ', ...legacyAll, `  ${legacyAll[0]}\n`, `${legacyAll.at(-1)}\n- 추가`]
  .map((input) => ({ input, result: settings.upgradeRefinementPrompt(input) }));
const modelIds = ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1', 'gpt-4o-transcribe-2025-03-20', 'gpt-4o', 'gpt-5-mini', 'o3',
  'gpt-4o-audio-preview', 'gpt-4o-realtime-preview', 'tts-1', 'text-embedding-3-small', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4_x', 'GPT-4o',
  'gpt-5', 'gpt-5.6-luna', 'o1-pro', 'o4-mini', 'gpt-image-1', 'omni-moderation-latest', 'transcribe', 'x-transcribe', 'gpt-4o-mini-tts',
  'gpt-5-2025-08-07_x', 'gpt-3.5-turbo', 'o1', 'gpt-4', 'gpt-4-turbo', 'gpt-40'];
out.classify = { input: modelIds, result: settings.classifyVoiceModels(modelIds) };
out.withSelected = [
  [{ transcription: ['whisper-1'], refinement: ['gpt-4o'] }, { transcriptionModel: 'gpt-transcribe', refinementModel: 'a-custom-model' }],
  [{ transcription: ['whisper-1'], refinement: ['gpt-4o'] }, { transcriptionModel: 'gpt-4o-transcribe-2025-03-20', refinementModel: '' }],
  [{ transcription: ['b', 'A', 'a', '_x', '-x', '.x', '1'], refinement: ['gpt-4o', 'gpt-4.1'] }, { transcriptionModel: 'B', refinementModel: 'gpt-4o' }]
].map(([lists, selected]) => ({ lists, selected, result: settings.withSelectedModels(lists, selected) }));
out.dated = ['gpt-4o-2024-08-06', 'gpt-4o-2024-08-06-x', 'gpt-4o-2024-08-06_x', 'gpt-4o-2024-08-06x', ' gpt-2024-01-01 ', 'gpt-4o', '2024-01-01']
  .map((input) => ({ input, result: settings.isDatedModelSnapshot(input) }));
// uniqueModels는 내보내지 않아 save/load를 거쳐 실행한다.
const memory = new Map();
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
const uniqueInput = [' gpt-transcribe ', 'gpt-transcribe', '', 'gpt-4o-transcribe-2025-03-20', 'b', 'a', 'b'];
settings.saveVoiceModelLists({ transcription: uniqueInput, refinement: [] });
out.unique = { input: uniqueInput, result: settings.loadVoiceModelLists().transcription };
out.mask = ['sk-proj-1234567890abcdefghij', 'sk-short', '', '12345678901234567890', '123456789012345678901']
  .map((input) => ({ input, result: settings.maskApiKey(input) }));
out.defaults = {
  transcriptionModel: settings.DEFAULT_TRANSCRIPTION_MODEL,
  refinementModel: settings.DEFAULT_REFINEMENT_MODEL,
  refinementPrompt: settings.DEFAULT_REFINEMENT_PROMPT,
  presets: [settings.TYPO_CORRECTION_REFINEMENT_PROMPT, settings.WRITTEN_STYLE_REFINEMENT_PROMPT, settings.CONCLUSION_FOCUSED_REFINEMENT_PROMPT],
  modelLists: settings.DEFAULT_VOICE_MODEL_LISTS,
  legacy: { typo: legacy.SUPERSEDED_TYPO_PROMPTS, written: legacy.SUPERSEDED_WRITTEN_PROMPTS, conclusion: legacy.SUPERSEDED_CONCLUSION_PROMPTS }
};

// voice-notes.js
out.paragraphs = ['\r\n첫 문단\r\n둘째\n\n\n셋째\n', '', '\r\r한\r두　', ' a \n b ']
  .map((input) => ({ input, result: voiceNotes.normalizeVoiceParagraphs(input) }));
out.suggestedTitles = ['  회의\n  메모  ', '가'.repeat(60), '', 'a  b', '😀'.repeat(24) + '가나다']
  .map((input) => ({ input, result: voiceNotes.normalizeSuggestedTitle(input) }));
out.knownTags = [
  [['Work', '없는 태그', 'home', 'HOME'], ['work', 'home']],
  [['İstanbul', 'ΣΊΣΥΦΟΣ'], ['i̇stanbul', 'σίσυφος']],
  [[], ['a']]
].map(([selected, labels]) => ({ selected, labels, result: voiceNotes.knownTagNames(selected, labels.map((name) => ({ name }))) }));
out.compose = [];
for (const titleMode of ['first-line', 'separate', 'other']) {
  for (const [body, suggestedTitle] of [['본문', '제목'], ['첫 줄\n\n둘째', ''], ['', ''], ['', '제목'], ['  공백 첫 줄  \n둘째', '']]) {
    out.compose.push({ titleMode, body, suggestedTitle, result: voiceNotes.composeVoiceIssue({ titleMode, body, suggestedTitle }) });
  }
}
out.audioFiles = [['audio/webm;codecs=opus', '2026-09-19T01:02:03.456Z'], ['audio/mp4', '2026-01-02T23:59:59.000Z'], ['', '2026-09-19T01:02:03.007Z']]
  .map(([type, iso]) => {
    const file = voiceNotes.voiceAudioFile(new Blob(['a'], { type }), new Date(iso));
    return { type, iso, name: file.name, fileType: file.type };
  });
out.attachmentLinks = [['octo/notes', '.issue-note-assets/issues/3/voice.webm'], ['o/n', '.issue-note-assets/issues/3/음성 #1.webm']]
  .map(([repo, path]) => ({ repo, path, link: voiceNotes.voiceAttachmentLink(repo, { path }), appended: voiceNotes.appendVoiceAttachmentLink('본문', repo, { path }) }));

// NoteEditor.svelte의 음성 도우미: 원본 소스에서 함수를 잘라 그대로 실행한다.
const editor = readFileSync(fileURLToPath(new URL('../../../../src/lib/NoteEditor.svelte', import.meta.url)), 'utf8');
const pick = (pattern) => { const match = editor.match(pattern); if (!match) throw new Error(`not found: ${pattern}`); return match[0]; };
const helperSource = [
  "const ATTACHMENT_BRANCH = 'ginote-assets';",
  pick(/const VOICE_AUDIO_MARKUP = .*;/),
  ...['appendVoiceText', 'voiceAudioMarkup', 'commentTextForEditing', 'commentAudioSources', 'attachmentPathFromRawUrl']
    .map((name) => pick(new RegExp(`  function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`))),
  // updateCommentBody의 본문 조립(rawValue는 이미 첨부 주소를 펼친 값)
  pick(/const audioMarkup = voiceAudioMarkup\(comment\.body\);/),
  'const rawValue = value;',
  pick(/comment\.body = `\$\{rawValue\}.*;/).replace('comment.body =', 'const updated ='),
  // voiceCommentEdit 처리의 본문 조립
  pick(/const editableBody = commentTextForEditing\(comment\.body\);/),
  pick(/const nextBody = appendVoiceText\(editableBody, voiceCommentEdit\.body\);/),
  pick(/const existingAudioMarkup = voiceAudioMarkup\(comment\.body\);/),
  pick(/comment\.body = voiceCommentEdit\.attachmentLink\n[^\n]*\n[^\n]*;/).replace('comment.body =', 'const edited ='),
  'return { appendVoiceText, voiceAudioMarkup, commentTextForEditing, commentAudioSources, attachmentPathFromRawUrl, updated, edited };'
].join('\n');
const run = (comment, value, voiceCommentEdit) => new Function('comment', 'value', 'voiceCommentEdit', helperSource)(comment, value, voiceCommentEdit);
const helpers = run({ body: '' }, '', { body: '', attachmentLink: '' });
out.appendText = [['기존 본문  \n\n', '  새 전사  '], ['', ' 전사 '], ['   ', '전사'], ['본문', '']]
  .map(([source, transcript]) => ({ source, transcript, result: helpers.appendVoiceText(source, transcript) }));
const audioA = '<audio controls preload="metadata" src="https://github.com/o/n/raw/ginote-assets/.issue-note-assets/issues/3/voice-a.webm"><a href="https://github.com/o/n/raw/ginote-assets/.issue-note-assets/issues/3/voice-a.webm">🎙 원본 음성 다운로드</a></audio>';
const audioB = '<audio\n controls preload="metadata"  src="https://github.com/o/n/raw/ginote-assets/.issue-note-assets/issues/3/%EC%9D%8C%EC%84%B1%20b.webm" data-x="1">\n<a>b</a>\n</audio>';
const commentBodies = [
  `댓글 글\n\n${audioA}`,
  `앞\n\n\n\n${audioA}\n\n\n\n중간\n${audioB}  \n`,
  '음성 없는 댓글  ',
  audioA,
  `<audio controls src="x"></audio> 글`
];
out.commentHelpers = commentBodies.map((body) => ({
  body,
  markup: helpers.voiceAudioMarkup(body),
  editing: helpers.commentTextForEditing(body),
  sources: helpers.commentAudioSources(body),
  paths: helpers.commentAudioSources(body).map(helpers.attachmentPathFromRawUrl)
}));
out.rawPaths = ['https://github.com/o/n/raw/ginote-assets/a/%ED%95%9C%EA%B8%80%20x.webm', 'https://example.com/a.webm', '', 'x/raw/ginote-assets/a%2Fb/c+d']
  .map((input) => ({ input, result: helpers.attachmentPathFromRawUrl(input) }));
const newLink = '<audio controls preload="metadata" src="https://github.com/o/n/raw/ginote-assets/new.webm"><a href="https://github.com/o/n/raw/ginote-assets/new.webm">🎙 원본 음성 다운로드</a></audio>';
out.commentEdits = [];
for (const body of commentBodies) {
  for (const [transcript, attachmentLink] of [['  새 전사  ', ''], ['새 전사', newLink], ['', newLink]]) {
    out.commentEdits.push({ body, transcript, attachmentLink, result: run({ body }, '', { body: transcript, attachmentLink }).edited });
  }
  for (const value of ['고친 글', '  ', '', '고친 글\n\n']) {
    out.commentEdits.push({ body, edited: value, updated: run({ body }, value, { body: '', attachmentLink: '' }).updated });
  }
}

writeFileSync(fileURLToPath(new URL('./web.json', import.meta.url)), `${JSON.stringify(out, null, 1)}\n`);
