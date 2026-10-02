import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./github.js', () => ({
  loadVoiceTranscriptionHints: vi.fn(),
  saveVoiceTranscriptionHints: vi.fn()
}));

import { loadVoiceTranscriptionHints, saveVoiceTranscriptionHints } from './github.js';
import { createTranscriptionHints } from './transcription-hints.js';
import { loadPendingVoiceTranscriptionHints, savePendingVoiceTranscriptionHints } from './voice-settings.js';

let context;
let hints;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  context = { token: 'token', repo: 'octo/notes' };
  hints = createTranscriptionHints(() => context);
  loadVoiceTranscriptionHints.mockResolvedValue('Ginote, Svelte');
  saveVoiceTranscriptionHints.mockResolvedValue('saved');
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('load', () => {
  it('저장소에서 읽어 오고, 같은 저장소는 다시 읽지 않는다', async () => {
    await hints.load();
    expect(get(hints)).toMatchObject({ value: 'Ginote, Svelte', loadedRepo: 'octo/notes', loading: false, error: '' });

    await hints.load();
    expect(loadVoiceTranscriptionHints).toHaveBeenCalledTimes(1);

    await hints.load(true);
    expect(loadVoiceTranscriptionHints).toHaveBeenCalledTimes(2);
  });

  it('읽는 중에 다시 부르면 같은 요청을 기다린다', async () => {
    const pending = deferred();
    loadVoiceTranscriptionHints.mockReturnValueOnce(pending.promise);

    const first = hints.load();
    const second = hints.load(true);
    expect(second).toBe(first);
    expect(get(hints).loading).toBe(true);

    pending.resolve('값');
    await first;
    expect(get(hints)).toMatchObject({ value: '값', loading: false });
  });

  it('아직 올리지 못한 이 기기의 수정분이 있으면 그 값을 쓴다', async () => {
    savePendingVoiceTranscriptionHints('octo/notes', '기기에서 고친 값');
    await hints.load();
    expect(get(hints).value).toBe('기기에서 고친 값');
    expect(loadVoiceTranscriptionHints).not.toHaveBeenCalled();
  });

  it('토큰이나 저장소가 없으면 읽지 않는다', async () => {
    context = { token: '', repo: 'octo/notes' };
    expect(hints.load()).toBeUndefined();
    expect(loadVoiceTranscriptionHints).not.toHaveBeenCalled();
  });

  it('읽기에 실패하면 이유를 남긴다', async () => {
    loadVoiceTranscriptionHints.mockRejectedValueOnce(new Error('rate limit'));
    await hints.load();
    expect(get(hints)).toMatchObject({ error: 'rate limit', loading: false, loadedRepo: '' });
  });

  it('읽는 사이 저장소를 바꾸면 이전 응답을 버린다', async () => {
    const pending = deferred();
    loadVoiceTranscriptionHints.mockReturnValueOnce(pending.promise);
    const task = hints.load();

    context = { token: 'token', repo: 'octo/other' };
    hints.reset();
    pending.resolve('이전 저장소 값');
    await task;

    expect(get(hints)).toMatchObject({ value: '', loadedRepo: '', loading: false });
  });
});

describe('stage와 flush', () => {
  it('고친 값은 바로 반영하고, flush할 때 저장소에 올린다', async () => {
    hints.stage('새 단어');
    expect(get(hints).value).toBe('새 단어');
    expect(loadPendingVoiceTranscriptionHints('octo/notes')).toBe('새 단어');

    await hints.flush();

    expect(saveVoiceTranscriptionHints).toHaveBeenCalledWith('token', 'octo/notes', '새 단어');
    expect(loadPendingVoiceTranscriptionHints('octo/notes')).toBeNull();
    expect(get(hints)).toMatchObject({ saving: false, loadedRepo: 'octo/notes' });
  });

  it('올릴 수정분이 없으면 요청하지 않는다', async () => {
    await hints.flush();
    expect(saveVoiceTranscriptionHints).not.toHaveBeenCalled();
  });

  it('올리기에 실패하면 수정분을 남기고 이유를 알린다', async () => {
    saveVoiceTranscriptionHints.mockRejectedValueOnce(new Error('403'));
    hints.stage('새 단어');
    await hints.flush();
    expect(get(hints)).toMatchObject({ error: '403', saving: false });
    expect(loadPendingVoiceTranscriptionHints('octo/notes')).toBe('새 단어');
  });

  it('올리는 사이 저장소를 바꿔도 새 저장소에서 다시 올릴 수 있다', async () => {
    const pending = deferred();
    saveVoiceTranscriptionHints.mockReturnValueOnce(pending.promise);
    hints.stage('이전 저장소 단어');
    const task = hints.flush();

    context = { token: 'token', repo: 'octo/other' };
    hints.reset();
    hints.stage('새 저장소 단어');
    await hints.flush();
    expect(saveVoiceTranscriptionHints).toHaveBeenLastCalledWith('token', 'octo/other', '새 저장소 단어');

    pending.resolve('saved');
    await task;
    // 이전 저장소 응답은 새 저장소 상태를 건드리지 않고, 이전 수정분은 다음에 다시 올린다.
    expect(get(hints).loadedRepo).toBe('octo/other');
    expect(loadPendingVoiceTranscriptionHints('octo/notes')).toBe('이전 저장소 단어');
  });
});
