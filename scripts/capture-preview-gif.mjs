#!/usr/bin/env node
// 더미 GitHub 저장소를 연결한 상태로 앱을 조작하면서, 화면이 바뀔 때마다
// 한 장씩 캡처한다. 프레임마다 재생 시간을 직접 지정해 GIF로 합치므로
// 실시간 녹화처럼 프레임이 누락되지 않는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createFixture, installGitHubMock, previewSettings } from './preview/fixture.mjs';
import { createRecorder, cursorInitScript } from './preview/recorder.mjs';
import { runScenario } from './preview/scenario.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const argValue = (name, defaultValue) => {
  const key = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(key));
  return match ? match.slice(key.length) : defaultValue;
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const numberArg = (name, defaultValue) => {
  const value = Number(argValue(name, defaultValue));
  return Number.isFinite(value) ? value : defaultValue;
};

const getOptions = () => ({
  width: numberArg('width', Number(process.env.PREVIEW_WIDTH || 1280)),
  height: numberArg('height', Number(process.env.PREVIEW_HEIGHT || 800)),
  gifWidth: numberArg('gif-width', Number(process.env.PREVIEW_GIF_WIDTH || 960)),
  output: argValue('output', process.env.PREVIEW_OUTPUT || 'docs/preview.gif'),
  frameDir: argValue('frames-dir', process.env.PREVIEW_FRAME_DIR || path.join(projectRoot, 'docs/preview/frames')),
  url: argValue('url', process.env.PREVIEW_URL || ''),
  port: numberArg('port', Number(process.env.PREVIEW_PORT || 4173)),
  language: argValue('lang', process.env.PREVIEW_LANG || 'en'),
  keepFrames: hasFlag('keep-frames') || process.env.PREVIEW_KEEP_FRAMES === '1',
  encode: !hasFlag('no-encode') && process.env.PREVIEW_NO_ENCODE !== '1',
  headless: !hasFlag('headful') && process.env.PREVIEW_HEADLESS !== 'false'
});

const runCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: projectRoot, ...options });
  if (result.status !== 0) throw new Error(`실행 실패: ${command} ${args.join(' ')}`);
  return result;
};

const hasCommand = (command) => {
  try {
    return spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};

const isReachable = async (url) => {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async (url, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};

// 미리 띄워 둔 서버가 없으면 vite preview를 직접 실행하고, 끝나면 정리한다.
const ensureServer = async ({ url, port }) => {
  const target = url || `http://127.0.0.1:${port}`;
  if (await isReachable(target)) return { target, stop: async () => {} };

  try {
    await fs.access(path.join(projectRoot, 'dist/index.html'));
  } catch {
    console.log('dist가 없어 먼저 빌드합니다.');
    runCommand('npm', ['run', 'build']);
  }

  console.log(`미리보기 서버를 시작합니다: ${target}`);
  const server = spawn(
    path.join(projectRoot, 'node_modules/.bin/vite'),
    ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: projectRoot, stdio: 'ignore' }
  );

  if (!(await waitForServer(target))) {
    server.kill();
    throw new Error(`미리보기 서버에 연결하지 못했습니다: ${target}`);
  }

  return {
    target,
    stop: async () => {
      server.kill();
    }
  };
};

const capture = async ({ target, options }) => {
  const fixture = createFixture();
  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark'
  });

  // 저장소·PAT를 미리 넣어 두면 설정 화면 없이 노트 목록부터 시작한다.
  const settings = previewSettings(options.language);
  settings.preferences.autoSaveSeconds = 3;

  await installGitHubMock(context, fixture);
  await context.addInitScript(cursorInitScript);
  await context.addInitScript((value) => {
    localStorage.setItem('issue-note.settings.v1', JSON.stringify(value));
    localStorage.setItem('issue-note.attachment-prune.v1', JSON.stringify({ [value.repo]: Date.now() }));
  }, settings);

  const page = await context.newPage();
  const recorder = await createRecorder(page, { frameDir: options.frameDir });

  await page.goto(target, { waitUntil: 'networkidle' });
  await runScenario(page, recorder);
  const frames = await recorder.writeManifest();

  await context.close();
  await browser.close();
  return frames;
};

const writeConcatList = async (frameDir, frames) => {
  const listPath = path.join(frameDir, 'frames.txt');
  const lines = [];
  for (const frame of frames) {
    lines.push(`file '${frame.file}'`);
    lines.push(`duration ${(frame.durationMs / 1000).toFixed(3)}`);
  }
  // concat 디먹서는 마지막 프레임 길이를 반영하려면 파일을 한 번 더 적어야 한다.
  if (frames.length) lines.push(`file '${frames.at(-1).file}'`);
  await fs.writeFile(listPath, `${lines.join('\n')}\n`);
  return listPath;
};

const encodeGif = async ({ frameDir, frames, gifWidth, output }) => {
  const listPath = await writeConcatList(frameDir, frames);
  const palette = path.join(frameDir, 'palette.png');
  const scale = `scale=${gifWidth}:-2:flags=lanczos`;

  runCommand('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', `${scale},palettegen=stats_mode=diff`,
    palette
  ]);

  runCommand('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-i', palette,
    '-lavfi', `[0:v]${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    '-fps_mode', 'vfr',
    '-loop', '0',
    output
  ]);
};

const main = async () => {
  const options = getOptions();
  const server = await ensureServer(options);
  let frames = [];
  try {
    frames = await capture({ target: server.target, options });
  } finally {
    await server.stop();
  }

  const totalMs = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  console.log(`프레임 ${frames.length}장 캡처 완료 (재생 길이 ${(totalMs / 1000).toFixed(1)}초): ${options.frameDir}`);

  if (!options.encode) return;
  if (!hasCommand('ffmpeg')) {
    console.log('ffmpeg가 없어 GIF를 만들지 못했습니다. 프레임만 남깁니다.');
    return;
  }

  await encodeGif({ frameDir: options.frameDir, frames, gifWidth: options.gifWidth, output: options.output });
  const { size } = await fs.stat(path.join(projectRoot, options.output));
  console.log(`GIF 생성 완료: ${options.output} (${(size / 1024 / 1024).toFixed(2)} MB)`);

  if (!options.keepFrames) await fs.rm(options.frameDir, { recursive: true, force: true });
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
