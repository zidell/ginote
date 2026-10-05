// 웹 규약 모듈(src/lib)을 Node에서 불러온다. note-lock.js의 pepper는 Vite가 빌드 때 넣는 값이라,
// 소스의 `import.meta.env?.VITE_NOTE_LOCK_PEPPER`를 지정한 값으로 바꾼 사본을 불러온다.
// .env 파일은 읽지 않는다(공식 pepper가 테스트 데이터에 섞이지 않게).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lib = (name) => pathToFileURL(join(repoRoot, 'src/lib', name)).href;

const lockModules = new Map();

export async function loadNoteLock(pepper = '') {
  if (lockModules.has(pepper)) return lockModules.get(pepper);
  const source = readFileSync(join(repoRoot, 'src/lib/note-lock.js'), 'utf8');
  const marker = 'import.meta.env?.VITE_NOTE_LOCK_PEPPER';
  if (!source.includes(marker)) throw new Error(`note-lock.js no longer reads ${marker}; update web-modules.mjs`);
  const directory = mkdtempSync(join(tmpdir(), 'ginote-lock-'));
  const file = join(directory, 'note-lock.mjs');
  writeFileSync(file, source.replace(marker, JSON.stringify(pepper)));
  const module = await import(pathToFileURL(file).href);
  lockModules.set(pepper, module);
  return module;
}

export const loadAttachments = () => import(lib('attachments.js'));
export const loadNotes = () => import(lib('notes.js'));
export const loadDueDate = () => import(lib('due-date.js'));
export const loadColors = () => import(lib('colors.js'));
export const loadTagDefinition = () => import(lib('tag-definition.js'));
export const loadIssueLabels = () => import(lib('issue-labels.js'));
export const loadRepoAddress = () => import(lib('repo-address.js'));
export const loadNoteMerge = () => import(lib('note-merge.js'));
