#!/usr/bin/env node
// 웹 규약 코드(src/lib)로 Swift 호환 테스트의 기대값을 만든다(macos/DESIGN.md §9).
//
//   node macos/scripts/make-fixtures.mjs          기대값 파일을 다시 쓴다
//   node macos/scripts/make-fixtures.mjs --check  웹 코드가 바뀌어 기대값과 어긋나면 실패한다
//
// 잠금 암호문은 매번 salt·IV가 달라 --check 비교에서 뺀다.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadAttachments, loadColors, loadDueDate, loadIssueLabels, loadNoteLock, loadNoteMerge,
  loadNotes, loadRepoAddress, loadTagDefinition, repoRoot
} from './web-modules.mjs';
import { VOICE_SWIFT, voiceSwiftSource } from './voice-templates.mjs';
import { pathToFileURL } from 'node:url';

process.env.TZ = 'Asia/Seoul';
const FIXTURE = join(repoRoot, 'macos/Packages/GinoteCore/Tests/GinoteCoreTests/Fixtures/web.json');
const TEST_PEPPER = 'fixture-pepper::not-a-real-deployment-value';
const REPO = 'octo/notes';

const texts = [
  '', '   ', '첫 줄이 제목\n두 번째 줄', '  앞뒤 공백  \r\n다음', '가'.repeat(60), '📝'.repeat(51),
  '# **제목**\n- [x] [링크](https://example.com)와 `코드`', '![풍경](https://example.com/a.png) 다음 문장',
  '> 인용문 _강조_ ~~취소~~', '1. 첫째\n2) 둘째', '```js\nconst a = 1;\n```\n본문', '[참조]: https://x.y "t"\n남는 줄',
  '<b>굵게</b> \\*별표\\*', '---\n구분선 뒤', 'due: 2026-09-23\n본문', 'Due: 2026-02-30', '**Due: 2026-9-3**',
  '## Due: 2026-12-31', 'due: 2026-10-04 extra', 'Mixed 한글 and English 😀 text', '\t탭으로 시작\n',
  '#태그 이름', '##  여러 칸  공백 ', 'a'.repeat(70)
];

const linkBodies = [
  ['앞 [GitHub](https://github.com/example/repo) 뒤', [2, 4, 20, 45]],
  ['문서: https://example.com/guide?q=note.', [0, 10, 36, 37]],
  ['![사진](https://example.com/a.png) 일반 텍스트', [3, 20]],
  ['(https://example.com/path) 괄호 [제목 "x"](https://a.b/c "t")', [5, 30, 40]],
  ['😀 https://ex.com/😀path 끝', [3, 10, 18]]
];

function attachmentBodies(attachments) {
  const image = attachments.composeAttachmentLink(REPO, { name: '사진.png', path: '.issue-note-assets/issues/31/0f1e2d3c-4b5a-4c7d-8e9f-a0b1c2d3e4f5-사진.png' });
  const file = attachments.composeAttachmentLink(REPO, { name: 'plan 1.pdf', path: '.issue-note-assets/issues/31/0f1e2d3c-4b5a-4c7d-8e9f-a0b1c2d3e4f6-plan 1.pdf' });
  const comment = attachments.composeAttachmentLink(REPO, { name: 'a#b.txt', type: 'text/plain', path: '.issue-note-assets/issues/31/comments/77/0f1e2d3c-4b5a-4c7d-8e9f-a0b1c2d3e4f7-a#b.txt' });
  const managed = attachments.withManagedAttachmentBlock('본문 첫 줄\n\n둘째 문단', [image, file]);
  return {
    links: [image, file, comment],
    bodies: [
      '', '본문만 있음', managed, `${managed}\n\n${comment}`, `수동 ${image} 링크`,
      `${attachments.MANAGED_ATTACHMENT_START}\n\n${file}\n\n${attachments.MANAGED_ATTACHMENT_END}`,
      `앞\n\n\n\n${file}\n\n\n뒤`, '[이름 \\] 포함](https://github.com/o/r/raw/ginote-assets/x/%ED%95%9C.png)'
    ]
  };
}

async function deterministic() {
  const [attachments, notes, due, colors, tagDefinition, labels, repo, merge, lock] = await Promise.all([
    loadAttachments(), loadNotes(), loadDueDate(), loadColors(), loadTagDefinition(), loadIssueLabels(),
    loadRepoAddress(), loadNoteMerge(), loadNoteLock('')
  ]);
  const { links, bodies } = attachmentBodies(attachments);
  const now = new Date(2026, 9, 4, 15, 30);
  const fmtDate = (d) => d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

  return {
    notes: texts.map((input) => ({
      input,
      automaticTitle: notes.automaticTitle(input),
      automaticTitle10: notes.automaticTitle(input, 10),
      plainText: notes.markdownToPlainText(input),
      firstLinePreview: notes.firstLinePreview(input),
      shortenMiddle12: notes.shortenMiddle(input, 12),
      normalizeTagName: notes.normalizeTagName(input),
      dueDate: fmtDate(due.parseDueDate(input)),
      dueBadge: due.dueBadge(input, now)
    })),
    linkAtCursor: linkBodies.flatMap(([body, cursors]) => cursors.map((cursor) => ({
      body, cursor, link: notes.linkAtCursor(body, cursor)
    }))),
    dueLabels: [-3, -1, 0, 1, 12].map((days) => ({ days, label: due.dueBadgeLabel(days) })),
    tagColors: ['여행', '업무', '아이디어', 'ab', 'ba', 'Work', 'é', 'é', '😀 emoji', ''].map((name) => ({
      name, color: colors.tagColorForName(name)
    })),
    tagDefinitions: [
      ['업무: 회사 일', null], ['업무', null], [' 이름 : 설명 : 더 ', null], ['a:b: 설명', 'a:b'], ['a:b', 'a:b'], [':설명만', null]
    ].map(([value, current]) => ({ value, current, parsed: tagDefinition.parseTagDefinition(value, current ? { name: current } : null) })),
    tagLimits: [{ name: '가'.repeat(60), description: '😀'.repeat(120) }, { name: '  짧음 ', description: '' }]
      .map((tag) => ({ tag, limited: labels.limitTagInput(tag) })),
    repoAddresses: ['octo/notes', 'https://github.com/octo/notes.git', ' /octo/notes/ ', 'octo', 'a/b/c', 'HTTP://GitHub.com/x/y']
      .map((input) => ({ input, parsed: repo.parseRepositoryAddress(input) })),
    tokens: ['​ghp_abc﻿ ', ' github_pat_x⁠'].map((input) => ({ input, normalized: repo.normalizeToken(input) })),
    patURLs: ['octo/notes', '', 'someone/a-very-long-repository-name-for-notes'].map((input) => ({ input, url: repo.makePatCreationUrl(input) })),
    attachments: {
      repo: REPO,
      links,
      rawURL: attachments.attachmentRawUrl(REPO, '.issue-note-assets/issues/9/a b#c/한글.png'),
      isImageCases: [['a.PNG', null], ['b.pdf', null], ['c', 'image/heic'], ['d.webp', 'application/octet-stream']]
        .map(([name, type]) => ({ name, type, link: attachments.composeAttachmentLink(REPO, { name, type, path: `p/${name}` }) })),
      bodies: bodies.map((body) => ({
        body,
        paths: attachments.parseAttachmentPaths(body),
        stripped: attachments.stripManagedAttachmentBlocks(body),
        managedLinks: attachments.managedAttachmentLinks(body),
        withBlock: attachments.withManagedAttachmentBlock(body, links.slice(0, 2)),
        withoutBlock: attachments.withManagedAttachmentBlock(body, []),
        compressed: attachments.compressAttachmentLinks(body, REPO),
        roundTrip: attachments.expandAttachmentLinks(attachments.compressAttachmentLinks(body, REPO), REPO),
        removedFirst: attachments.removeAttachmentLink(body, links[0]),
        inserted: [null, 0, 3, body.length].map((position) => ({
          position, result: attachments.insertAttachmentLinks(body, links.slice(1), position)
        }))
      }))
    },
    lockTitles: ['메모', '🔒 메모', '🔒메모', '🔒   ', '', '가'.repeat(300)].map((title) => ({
      title, locked: lock.isLockedTitle(title), added: lock.addLockToTitle(title), removed: lock.removeLockFromTitle(title)
    })),
    lockPins: ['123456', '12-34-56', '1234567', '12345', 'abc', '１２３４５６'].map((value) => ({ value, pin: lock.normalizeLockPin(value) })),
    merge: mergeFixture(merge),
    voice: await voiceFixture()
  };
}

async function voiceFixture() {
  const notes = await import(pathToFileURL(join(repoRoot, 'src/lib/voice-notes.js')).href);
  const settings = await import(pathToFileURL(join(repoRoot, 'src/lib/voice-settings.js')).href);
  const legacy = await import(pathToFileURL(join(repoRoot, 'src/lib/voice-refinement-legacy-prompts.js')).href);
  const attachment = { path: '.issue-note-assets/issues/5/0f1e2d3c-4b5a-4c7d-8e9f-a0b1c2d3e4f5-voice-2026.m4a' };
  return {
    paragraphs: ['한 줄\n두 줄\r\n\n\n세 줄  ', '', '\n\n앞뒤\n\n'].map((input) => ({ input, output: notes.normalizeVoiceParagraphs(input) })),
    titles: ['  제목   여러   칸  ', 'x'.repeat(70)].map((input) => ({ input, output: notes.normalizeSuggestedTitle(input) })),
    compose: [
      { titleMode: 'first-line', body: '본문', suggestedTitle: '제안' },
      { titleMode: 'first-line', body: '본문 첫 줄\n둘째', suggestedTitle: '' },
      { titleMode: 'separate', body: '본문', suggestedTitle: '제안' },
      { titleMode: 'separate', body: '첫 줄\n둘째', suggestedTitle: '' },
      { titleMode: 'separate', body: '', suggestedTitle: '' },
      { titleMode: 'first-line', body: '', suggestedTitle: '제안' }
    ].map((input) => ({ input, output: notes.composeVoiceIssue(input) })),
    audioLink: notes.voiceAttachmentLink(REPO, attachment),
    audioPath: attachment.path,
    upgrades: [
      ...legacy.SUPERSEDED_TYPO_PROMPTS, ...legacy.SUPERSEDED_WRITTEN_PROMPTS, ...legacy.SUPERSEDED_CONCLUSION_PROMPTS,
      '', '  ', '내가 고친 규칙'
    ].map((input) => ({ input, output: settings.upgradeRefinementPrompt(input) })),
    classified: settings.classifyVoiceModels([
      'gpt-4o-transcribe', 'gpt-4o-transcribe-2025-03-20', 'whisper-1', 'gpt-transcribe', 'gpt-5.6-luna', 'gpt-4.1',
      'o3-mini', 'gpt-4o-audio-preview', 'gpt-realtime', 'tts-1', 'text-embedding-3', 'dall-e-3', 'gpt-4o-mini-tts'
    ]),
    masks: ['', 'short', 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'].map((input) => ({ input, output: settings.maskApiKey(input) }))
  };
}

function mergeFixture(merge) {
  const issues = [
    {
      number: 12, title: '둘째', created_at: '2026-10-02T03:00:00Z', user: { login: 'zidell' },
      body: `둘째 본문 ![](https://github.com/${REPO}/raw/ginote-assets/.issue-note-assets/issues/12/u-a.png)`,
      comments: [{ createdAt: '2026-10-02T03:00:00Z', author: 'zidell', body: '같은 시각 댓글' }, { createdAt: '2026-10-03T00:00:00Z', author: '', body: '  ' }]
    },
    { number: 7, title: '첫째', created_at: '2026-10-01T23:59:59Z', user: { login: 'zidell' }, body: '첫째 본문', comments: [] },
    { number: 9, title: '', created_at: 'not-a-date', user: null, body: '', comments: [] }
  ];
  const replacements = new Map([['.issue-note-assets/issues/12/u-a.png', '.issue-note-assets/issues/40/v-a.png']]);
  const rewritten = issues.map((issue) => ({ ...issue, body: merge.replaceAttachmentUrls(issue.body, REPO, replacements) }));
  const timeline = merge.mergeTimeline(rewritten);
  return {
    timeZone: process.env.TZ,
    repo: REPO,
    issues,
    replacements: [...replacements],
    earliest: merge.earliestIssue(issues).number,
    timeline: timeline.map((entry) => ({ kind: entry.kind, issueNumber: entry.issueNumber, createdAt: entry.createdAt })),
    body: merge.formatMergedBody(timeline),
    comments: merge.mergedComments(rewritten).map((entry) => ({ issueNumber: entry.issueNumber, body: entry.body }))
  };
}

async function lockFixture() {
  const bodies = ['비밀 본문\n두 번째 줄 😀', '', 'x'.repeat(2000)];
  const make = async (pepper) => {
    const lock = await loadNoteLock(pepper);
    return Promise.all(bodies.map(async (body, index) => {
      const pin = ['123456', '000000', '987654'][index];
      const issue = [1, 31, 4021][index];
      return { pin, issue, body, payload: await lock.encryptLockedBody(body, pin, issue) };
    }));
  };
  return { testPepper: TEST_PEPPER, defaultPepper: await make(''), customPepper: await make(TEST_PEPPER) };
}

const expected = await deterministic();
if (process.argv.includes('--check')) {
  const current = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const swiftSource = readFileSync(VOICE_SWIFT, 'utf8');
  if (JSON.stringify(current.deterministic) !== JSON.stringify(expected) || swiftSource !== await voiceSwiftSource()) {
    console.error('Web rules changed: run `node macos/scripts/make-fixtures.mjs` and update the Swift code.');
    process.exit(1);
  }
  console.log('fixtures match the web code');
} else {
  writeFileSync(VOICE_SWIFT, await voiceSwiftSource());
  writeFileSync(FIXTURE, `${JSON.stringify({ deterministic: expected, lock: await lockFixture() }, null, 2)}\n`);
  console.log(`wrote ${FIXTURE}`);
}
