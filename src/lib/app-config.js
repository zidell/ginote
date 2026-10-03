import { parse } from 'smol-toml';
import { LOCALE_OPTIONS } from './i18n.js';
import { CODING_FONT_OPTIONS } from './editor-fonts.js';
import { parseRepositoryAddress } from './repo-address.js';
import {
  LOCK_SESSION_DEFAULT_MINUTES,
  LOCK_SESSION_OPTIONS,
  THEME_DEFAULT,
  THEME_OPTIONS,
  WORKSPACE_CACHE_DEFAULT_MINUTES,
  WORKSPACE_CACHE_OPTIONS,
  normalizePreferences
} from './settings-storage.js';
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from './sidebar-width.js';
import {
  DEFAULT_REFINEMENT_MODEL,
  DEFAULT_REFINEMENT_PROMPT,
  DEFAULT_TRANSCRIPTION_MODEL
} from './voice-settings.js';

// 설치형 앱의 config.toml 형식이다(docs/CONFIG.md). 사람과 에이전트가 이 파일 하나만 읽고도
// 값을 바꿀 수 있도록, 키마다 뜻·타입·허용값·기본값·적용 시점을 주석으로 적는다. 앱이 저장할
// 때마다 이 스키마로 파일 전체를 다시 만들므로 설명이 사라지지 않는다. 자격 증명(PAT, OpenAI
// 키)은 이 파일에 쓰지 않는다.

export const CONFIG_VERSION = 1;
const FIXED_FONTS = ['system', 'sans', 'serif', 'mono'];

const pick = (allowed, fallback) => (value) => (allowed.includes(value) ? value : fallback);
const range = (minimum, maximum, fallback, { integer = true } = {}) => (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(maximum, Math.max(minimum, value));
  return integer ? Math.round(clamped) : Math.round(clamped * 100) / 100;
};
const boolean = (fallback) => (value) => (typeof value === 'boolean' ? value : fallback);
const text = (fallback) => (value) => (typeof value === 'string' ? value.trim() : fallback);

function normalizeFont(value) {
  if (typeof value !== 'string') return 'system';
  if (FIXED_FONTS.includes(value) || CODING_FONT_OPTIONS.some((font) => font.value === value)) return value;
  if (value.startsWith('local:') && value.slice(6).trim()) return value;
  return 'system';
}

// 파일의 키와 앱 내부 값의 대응. path는 [표, 키], read/write는 내부 스냅샷에서 값을 꺼내고 넣는다.
const ENTRIES = [
  {
    path: ['display', 'theme'],
    get: (s) => s.preferences.theme,
    set: (s, v) => { s.preferences.theme = v; },
    normalize: pick(THEME_OPTIONS, THEME_DEFAULT),
    doc: ['Color theme.', `Allowed: ${quoteList(THEME_OPTIONS)}. Default: "${THEME_DEFAULT}". Applied immediately.`]
  },
  {
    path: ['display', 'language'],
    get: (s) => s.preferences.language,
    set: (s, v) => { s.preferences.language = v; },
    normalize: pick(LOCALE_OPTIONS.map((option) => option.value), 'auto'),
    doc: [
      'Interface language. "auto" follows the operating system language.',
      `Allowed: ${quoteList(LOCALE_OPTIONS.map((option) => option.value))}. Default: "auto". Applied immediately.`
    ]
  },
  {
    path: ['display', 'title_mode'],
    get: (s) => s.preferences.titleMode,
    set: (s, v) => { s.preferences.titleMode = v; },
    normalize: pick(['first-line', 'separate'], 'first-line'),
    doc: [
      'How a note gets its title.',
      '"first-line": the first 50 characters of the first line become the title.',
      '"separate": the title is typed in its own field.',
      'Default: "first-line". Applied immediately.'
    ]
  },
  {
    path: ['display', 'editor_font'],
    get: (s) => s.preferences.editorFont,
    set: (s, v) => { s.preferences.editorFont = v; },
    normalize: normalizeFont,
    doc: [
      'Editor font.',
      `Allowed: ${quoteList(FIXED_FONTS)} (system UI, sans-serif, serif, monospace),`,
      `bundled coding fonts ${quoteList(CODING_FONT_OPTIONS.map((font) => font.value))},`,
      'or "local:<font family installed on this computer>", e.g. "local:Menlo".',
      'Default: "system". Applied immediately.'
    ]
  },
  {
    path: ['display', 'editor_font_size'],
    get: (s) => s.preferences.editorFontSize,
    set: (s, v) => { s.preferences.editorFontSize = v; },
    normalize: range(12, 32, 17),
    doc: ['Editor font size in px. Integer 12..32. Default: 17. Applied immediately.']
  },
  {
    path: ['display', 'editor_line_height'],
    get: (s) => s.preferences.editorLineHeight,
    set: (s, v) => { s.preferences.editorLineHeight = v; },
    normalize: range(1.2, 2.5, 1.8, { integer: false }),
    doc: ['Editor line height as a multiple of the font size. Number 1.2..2.5. Default: 1.8. Applied immediately.']
  },
  {
    path: ['display', 'editor_max_width'],
    get: (s) => s.preferences.editorMaxWidth,
    set: (s, v) => { s.preferences.editorMaxWidth = v; },
    normalize: range(480, 1600, 840),
    doc: ['Maximum width of the note text column in px. Integer 480..1600. Default: 840. Applied immediately.']
  },
  {
    path: ['display', 'sidebar_width'],
    get: (s) => s.sidebarWidth,
    set: (s, v) => { s.sidebarWidth = v; },
    normalize: range(SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_DEFAULT),
    doc: [
      `Width of the note list next to the editor in px (wide windows only). Integer ${SIDEBAR_WIDTH_MIN}..${SIDEBAR_WIDTH_MAX}.`,
      `Default: ${SIDEBAR_WIDTH_DEFAULT}. Dragging the divider in the app also changes it. Applied immediately.`
    ]
  },
  ...['title', 'summary', 'meta', 'tags'].map((field) => ({
    path: ['display', 'list_row', field],
    get: (s) => s.preferences.listRowFields[field],
    set: (s, v) => { s.preferences.listRowFields[field] = v; },
    normalize: boolean(true),
    doc: [{
      title: 'Show the note title in each row of the note list.',
      summary: 'Show the first lines of the note body in each row of the note list.',
      meta: 'Show the time information (created or updated) in each row of the note list.',
      tags: 'Show the tags in each row of the note list.'
    }[field], 'true / false. Default: true. Applied immediately.']
  })),
  {
    path: ['behavior', 'auto_save_seconds'],
    get: (s) => s.preferences.autoSaveSeconds,
    set: (s, v) => { s.preferences.autoSaveSeconds = v; },
    normalize: range(3, 30, 5),
    doc: ['Seconds of inactivity before an edited note is saved to GitHub. Integer 3..30. Default: 5. Applied immediately.']
  },
  {
    path: ['behavior', 'notes_per_page'],
    get: (s) => s.preferences.issuePageSize,
    set: (s, v) => { s.preferences.issuePageSize = v; },
    normalize: range(10, 100, 30),
    doc: ['Number of notes loaded at a time in the note list. Integer 10..100. Default: 30. The list reloads when it changes.']
  },
  {
    path: ['behavior', 'lock_session_minutes'],
    get: (s) => s.preferences.lockSessionMinutes,
    set: (s, v) => { s.preferences.lockSessionMinutes = v; },
    normalize: pick(LOCK_SESSION_OPTIONS, LOCK_SESSION_DEFAULT_MINUTES),
    doc: [
      'Minutes that locked (encrypted) notes stay readable after you enter the lock number.',
      `Allowed: ${LOCK_SESSION_OPTIONS.join(', ')}. Default: ${LOCK_SESSION_DEFAULT_MINUTES}. Applied immediately.`
    ]
  },
  {
    path: ['behavior', 'workspace_cache_minutes'],
    get: (s) => s.preferences.workspaceCacheMinutes,
    set: (s, v) => { s.preferences.workspaceCacheMinutes = v; },
    normalize: pick(WORKSPACE_CACHE_OPTIONS, WORKSPACE_CACHE_DEFAULT_MINUTES),
    doc: [
      'Minutes a workspace\'s note list is kept in memory, so switching back to it shows the list instantly.',
      `Allowed: ${WORKSPACE_CACHE_OPTIONS.join(', ')}. Default: ${WORKSPACE_CACHE_DEFAULT_MINUTES}. Applied immediately.`
    ]
  },
  {
    path: ['voice', 'transcription_model'],
    get: (s) => s.voice.transcriptionModel,
    set: (s, v) => { s.voice.transcriptionModel = v; },
    normalize: text(DEFAULT_TRANSCRIPTION_MODEL),
    doc: [
      'OpenAI model that turns a voice recording into text, e.g. "gpt-transcribe", "gpt-4o-transcribe".',
      `Default: "${DEFAULT_TRANSCRIPTION_MODEL}". Applied to the next recording.`,
      'Voice notes also need an OpenAI API key, which can only be entered in the app.'
    ]
  },
  {
    path: ['voice', 'refinement_model'],
    get: (s) => s.voice.refinementModel,
    set: (s, v) => { s.voice.refinementModel = v; },
    normalize: text(DEFAULT_REFINEMENT_MODEL),
    doc: [
      'OpenAI model that tidies the transcript using refinement_prompt below.',
      `"" (empty) keeps the raw transcript. Default: "${DEFAULT_REFINEMENT_MODEL}". Applied to the next recording.`
    ]
  },
  {
    path: ['voice', 'preserve_original_audio'],
    get: (s) => s.voice.preserveOriginalAudio,
    set: (s, v) => { s.voice.preserveOriginalAudio = v; },
    normalize: boolean(false),
    doc: ['Attach the original recording to the note after a successful voice note. true / false. Default: false.']
  },
  {
    path: ['voice', 'refinement_prompt'],
    get: (s) => s.voice.refinementPrompt,
    set: (s, v) => { s.voice.refinementPrompt = v; },
    normalize: (value) => (typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_REFINEMENT_PROMPT),
    doc: [
      'Instructions given to refinement_model, in any language. Empty restores the default',
      '(fix obvious transcription errors and punctuation only). Applied to the next recording.'
    ]
  },
  {
    path: ['updates', 'check_automatically'],
    get: (s) => s.updates.checkAutomatically,
    set: (s, v) => { s.updates.checkAutomatically = v; },
    normalize: boolean(true),
    doc: [
      'Check GitHub for a new Ginote release at launch and every 6 hours, and offer to install it.',
      'true / false. Default: true. Applied immediately.'
    ]
  },
  {
    path: ['updates', 'skipped_version'],
    get: (s) => s.updates.skippedVersion,
    set: (s, v) => { s.updates.skippedVersion = v; },
    normalize: text(''),
    doc: [
      'Release the user chose not to install, e.g. "0.1.42". Ginote does not offer it again but',
      'still offers newer releases. "" offers every release. "Skip this version" in the app sets it.'
    ]
  }
];

const SECTION_DOCS = {
  display: 'Appearance of this device\'s Ginote window.',
  'display.list_row': 'Items shown in each row of the note list.',
  behavior: 'Saving, loading and locking.',
  voice: 'Voice notes (OpenAI). The API key is stored in the operating system\'s credential store, not here.',
  updates: 'Updates of the installed app itself (macOS and Linux). Windows gets updates from the Microsoft Store or App Installer, phones from their app stores; there these keys are ignored.'
};

const HEADER = [
  'Ginote settings',
  '',
  'This is the active settings file of the Ginote app on this device. Ginote rewrites the',
  'whole file (with these comments) whenever settings change in the app, so comments you add',
  'and key order are not kept; values are.',
  '',
  'Editing: change values while Ginote is running or not. A running desktop app applies a',
  'saved change within about a second; the mobile apps read it on the next launch.',
  'Afterwards read config-status.txt in this folder: it records when Ginote last loaded this',
  'file and lists any value it rejected (and the value it used instead).',
  'Invalid TOML is ignored as a whole and the previous settings stay in effect.',
  '',
  'Credentials: GitHub personal access tokens and the OpenAI API key are NOT in this file.',
  'They are kept in the operating system\'s credential store (Keychain, Windows Credential',
  'Manager, Secret Service, Android Keystore) and can only be entered in the app.',
  '',
  'Format: TOML 1.0 (https://toml.io). Lines starting with # are comments.'
];

function quoteList(values) {
  return values.map((value) => (typeof value === 'string' ? `"${value}"` : String(value))).join(', ');
}

function tomlString(value) {
  const textValue = String(value ?? '');
  // 여러 줄 문자열은 사람이 읽기 쉽도록 리터럴 블록으로 쓴다. ''' 가 들어 있으면 일반 문자열로 쓴다.
  if (textValue.includes('\n') && !textValue.includes("'''") && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(textValue)) {
    return `'''\n${textValue}'''`;
  }
  return JSON.stringify(textValue)
    .replace(/\u007f/g, '\\u007f')
    .replace(/\\u([0-9a-f]{4})/gi, (match, hex) => `\\u${hex.toUpperCase()}`);
}

function tomlValue(value) {
  if (typeof value === 'string') return tomlString(value);
  if (typeof value === 'boolean') return String(value);
  if (Number.isInteger(value)) return String(value);
  return Number(value).toFixed(2).replace(/0$/, '');
}

function comment(lines) {
  return lines.map((line) => (line ? `# ${line}` : '#')).join('\n');
}

// 내부 스냅샷 → config.toml 본문. 자격 증명(token, apiKey)은 넣지 않는다.
export function renderConfig(snapshot) {
  const out = [comment(HEADER), '', `version = ${CONFIG_VERSION}`, ''];
  out.push(comment([
    'id of the workspace opened at launch (one of the [[workspaces]] ids below).',
    'Changing it switches the running app to that workspace.'
  ]));
  out.push(`active_workspace = ${tomlString(snapshot.activeWorkspaceId || '')}`);

  let currentTable = '';
  for (const entry of ENTRIES) {
    const table = entry.path.slice(0, -1).join('.');
    if (table !== currentTable) {
      currentTable = table;
      out.push('', `# ${SECTION_DOCS[table]}`, `[${table}]`);
    }
    out.push('', comment(entry.doc), `${entry.path.at(-1)} = ${tomlValue(entry.get(snapshot))}`);
  }

  out.push('', comment([
    'Workspaces: GitHub repositories whose issues hold notes, in the order shown in the app.',
    'id         Stable identifier. Leave it as is; for a new workspace you may omit it.',
    'repo       "owner/name" of the GitHub repository.',
    'name       Display name; "" shows the repository address.',
    'remember_token  Keep this workspace\'s token in the credential store across launches.',
    '           false forgets the stored token at once; it can only be entered again in the app.',
    'Reordering, renaming and removing take effect immediately. A workspace added here asks',
    'for its token in the app when opened.'
  ]));
  for (const workspace of snapshot.workspaces) {
    out.push(
      '',
      '[[workspaces]]',
      `id = ${tomlString(workspace.id)}`,
      `repo = ${tomlString(workspace.repo)}`,
      `name = ${tomlString(workspace.displayName || '')}`,
      `remember_token = ${Boolean(workspace.rememberToken)}`
    );
  }
  return `${out.join('\n')}\n`;
}

function lookup(table, path) {
  let current = table;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(key in current)) {
      return { found: false };
    }
    current = current[key];
  }
  return { found: true, value: current };
}

function sameValue(a, b) {
  return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;
}

function describe(value) {
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? String(value);
}

export function defaultSnapshot() {
  return {
    workspaces: [],
    activeWorkspaceId: '',
    preferences: normalizePreferences({}),
    voice: {
      apiKey: '',
      refinementPrompt: DEFAULT_REFINEMENT_PROMPT,
      transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
      refinementModel: DEFAULT_REFINEMENT_MODEL,
      preserveOriginalAudio: false
    },
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    updates: { checkAutomatically: true, skippedVersion: '' }
  };
}

// config.toml 본문 → { snapshot, problems, rewrite }. TOML 문법이 틀리면 ConfigSyntaxError를 던진다.
// 값이 틀린 항목은 기본값(또는 범위 끝값)으로 바꾸고 problems에 적는다. 자격 증명은 비어 있다.
// rewrite가 true면 앱이 고친 값(새 워크스페이스 id 등)을 파일에 바로 다시 써야 한다.
export function parseConfig(source, createId = () => crypto.randomUUID()) {
  let table;
  try {
    table = parse(source);
  } catch (reason) {
    throw new ConfigSyntaxError(reason?.message || String(reason), reason?.line);
  }
  const snapshot = defaultSnapshot();
  const problems = [];
  let rewrite = false;

  for (const entry of ENTRIES) {
    const { found, value } = lookup(table, entry.path);
    if (!found) continue;
    const normalized = entry.normalize(value);
    entry.set(snapshot, normalized);
    if (!sameValue(normalized, value)) {
      problems.push(`${entry.path.join('.')} = ${describe(value)} is not allowed; using ${describe(normalized)}. ${entry.doc.join(' ')}`);
    }
  }

  const rawWorkspaces = table.workspaces ?? [];
  if (!Array.isArray(rawWorkspaces)) {
    problems.push('workspaces must be an array of [[workspaces]] tables; ignored.');
  } else {
    const seen = new Set();
    rawWorkspaces.forEach((raw, index) => {
      const label = `workspaces[${index}]`;
      const address = parseRepositoryAddress(raw?.repo);
      if (!address) {
        problems.push(`${label}.repo = ${describe(raw?.repo)} is not "owner/name"; this workspace is ignored.`);
        return;
      }
      let id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!id || seen.has(id)) {
        if (id) problems.push(`${label}.id = ${describe(id)} is used twice; a new id was assigned.`);
        id = createId();
        rewrite = true;
      }
      seen.add(id);
      snapshot.workspaces.push({
        id,
        repo: address.fullName,
        displayName: typeof raw.name === 'string' ? raw.name.trim() : '',
        rememberToken: typeof raw.remember_token === 'boolean' ? raw.remember_token : true,
        token: ''
      });
    });
  }

  const active = typeof table.active_workspace === 'string' ? table.active_workspace : '';
  if (snapshot.workspaces.some((workspace) => workspace.id === active)) {
    snapshot.activeWorkspaceId = active;
  } else {
    snapshot.activeWorkspaceId = snapshot.workspaces[0]?.id || '';
    if (active) problems.push(`active_workspace = ${describe(active)} matches no workspace; using ${describe(snapshot.activeWorkspaceId)}.`);
  }

  const known = new Set(['version', 'active_workspace', 'workspaces', 'display', 'behavior', 'voice', 'updates']);
  for (const key of Object.keys(table)) {
    if (!known.has(key)) problems.push(`Unknown key "${key}" is ignored.`);
  }
  for (const section of ['display', 'behavior', 'voice', 'updates']) {
    for (const key of Object.keys(table[section] ?? {})) {
      const isKnown = ENTRIES.some((entry) => entry.path[0] === section && entry.path[1] === key);
      if (!isKnown) problems.push(`Unknown key "${section}.${key}" is ignored.`);
    }
  }
  for (const key of Object.keys(table.display?.list_row ?? {})) {
    if (!['title', 'summary', 'meta', 'tags'].includes(key)) problems.push(`Unknown key "display.list_row.${key}" is ignored.`);
  }

  return { snapshot, problems, rewrite };
}

export class ConfigSyntaxError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'ConfigSyntaxError';
    this.line = line;
  }
}

// config-status.txt 본문. 에이전트가 고친 뒤 앱이 실제로 읽었는지, 거부된 값이 있는지 확인하는 곳이다.
export function renderStatus({ loadedAt, problems = [], syntaxError = null }) {
  const lines = [
    'Ginote settings status',
    `Last loaded: ${loadedAt}`,
    ''
  ];
  if (syntaxError) {
    lines.push(
      'Result: config.toml is not valid TOML. The previous settings are still in effect.',
      `Error: ${syntaxError.message}`
    );
  } else if (problems.length) {
    lines.push('Result: loaded with the following values rejected:', ...problems.map((problem) => `- ${problem}`));
  } else {
    lines.push('Result: loaded; every value was accepted.');
  }
  return `${lines.join('\n')}\n`;
}
