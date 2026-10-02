import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./openai-voice.js', () => ({
  listAvailableVoiceModels: vi.fn()
}));

import VoiceSettings from './VoiceSettings.svelte';
import { listAvailableVoiceModels } from './openai-voice.js';
import {
  TYPO_CORRECTION_REFINEMENT_PROMPT,
  VOICE_MODEL_LIST_STORAGE_KEY,
  VOICE_SETTINGS_STORAGE_KEY,
  WRITTEN_STYLE_REFINEMENT_PROMPT
} from './voice-settings.js';

const LONG_KEY = 'sk-proj-1234567890abcdefghij';

beforeEach(() => {
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  listAvailableVoiceModels.mockResolvedValue(['gpt-4o-transcribe', 'whisper-1', 'gpt-4o', 'gpt-5-mini', 'tts-1']);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});

function renderSettings(props = {}) {
  return render(VoiceSettings, {
    apiKey: '',
    refinementPrompt: TYPO_CORRECTION_REFINEMENT_PROMPT,
    transcriptionModel: 'gpt-transcribe',
    refinementModel: 'gpt-4o-mini',
    ...props
  });
}

function savedSettings() {
  return JSON.parse(localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY) || '{}');
}

function apiKeyInput() {
  return document.getElementById('voice-api-key');
}

describe('API 키 입력', () => {
  it('평소에는 키를 가려서 보여 주고, 편집할 때만 원문을 보여 준다', async () => {
    renderSettings({ apiKey: LONG_KEY });
    const input = apiKeyInput();
    expect(input.value).toBe('sk-proj-12...abcdefghij');
    expect(input.readOnly).toBe(true);

    await fireEvent.focus(input);
    expect(input.value).toBe(LONG_KEY);
    expect(input.type).toBe('password');

    await fireEvent.blur(input);
    expect(input.value).toBe('sk-proj-12...abcdefghij');
  });

  it('새 키를 입력하면 저장하고 잠시 뒤 쓸 수 있는 모델 목록을 받아 온다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderSettings();
    const input = apiKeyInput();
    await fireEvent.focus(input);

    await fireEvent.input(input, { target: { value: LONG_KEY } });
    expect(savedSettings().apiKey).toBe(LONG_KEY);
    expect(listAvailableVoiceModels).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();

    await waitFor(() => expect(JSON.parse(localStorage.getItem(VOICE_MODEL_LIST_STORAGE_KEY)).refinement).toContain('gpt-5-mini'));
    expect(listAvailableVoiceModels).toHaveBeenCalledWith(LONG_KEY, expect.any(AbortSignal));
    const transcriptionOptions = [...document.querySelectorAll('#voice-transcription-model option')].map((option) => option.value);
    // 선택 중이던 모델은 새 목록에 없어도 남긴다.
    expect(transcriptionOptions).toEqual(['gpt-4o-transcribe', 'gpt-transcribe', 'whisper-1']);
  });

  it('키를 입력하자마자 환경설정을 닫아도 모델 목록 갱신은 마저 한다', async () => {
    const { unmount } = renderSettings();
    const input = apiKeyInput();
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: LONG_KEY } });

    unmount();

    await waitFor(() => expect(listAvailableVoiceModels).toHaveBeenCalledTimes(1));
  });

  it('모델 목록을 가져오지 못하면 이유를 보여 준다', async () => {
    listAvailableVoiceModels.mockRejectedValueOnce(new Error('Incorrect API key'));
    renderSettings({ apiKey: LONG_KEY });

    await fireEvent.click(screen.getAllByRole('button', { name: '모델 목록 새로고침' })[0]);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Incorrect API key'));
  });

  it('키가 없으면 모델 목록 새로고침을 막는다', () => {
    renderSettings();
    expect(screen.getAllByRole('button', { name: '모델 목록 새로고침' }).every((button) => button.disabled)).toBe(true);
  });
});

describe('정제 설정', () => {
  it('정제 모델을 고르지 않으면 정제 규칙을 숨긴다', () => {
    renderSettings({ refinementModel: '' });
    expect(document.getElementById('voice-refinement-prompt')).toBeNull();
  });

  it('프리셋을 누르면 규칙을 바꾸고 저장한다', async () => {
    renderSettings({ apiKey: LONG_KEY });

    await fireEvent.click(screen.getByRole('button', { name: '중간' }));

    expect(document.getElementById('voice-refinement-prompt').value).toBe(WRITTEN_STYLE_REFINEMENT_PROMPT);
    expect(savedSettings().refinementPrompt).toBe(WRITTEN_STYLE_REFINEMENT_PROMPT);
  });

  it('원본 음성 보존을 켜면 저장한다', async () => {
    renderSettings({ apiKey: LONG_KEY });
    const checkbox = document.getElementById('voice-preserve-original');

    await fireEvent.click(checkbox);
    await fireEvent.change(checkbox);

    expect(savedSettings().preserveOriginalAudio).toBe(true);
  });
});

describe('전사 단어', () => {
  it('입력값을 부모에게 넘기고, 불러오는 동안에는 입력을 막는다', async () => {
    const onHintsInput = vi.fn();
    const { rerender } = renderSettings({ transcriptionHints: 'Ginote', onHintsInput });
    const input = document.getElementById('voice-transcription-hints');
    expect(input.value).toBe('Ginote');

    await fireEvent.input(input, { target: { value: 'Ginote, Svelte' } });
    expect(onHintsInput).toHaveBeenCalledWith('Ginote, Svelte');

    await rerender({ hintsLoading: true, hintsError: '불러오지 못했습니다.' });
    expect(input.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('불러오지 못했습니다.');
  });
});

describe('focusApiKey', () => {
  it('음성 설정을 강조하고 API 키 입력란에 포커스를 준다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { component } = renderSettings();

    await component.focusApiKey();

    expect(document.activeElement).toBe(apiKeyInput());
    expect(document.querySelector('.voice-settings').classList.contains('is-highlighted')).toBe(true);
    await vi.advanceTimersByTimeAsync(1800);
    expect(document.querySelector('.voice-settings').classList.contains('is-highlighted')).toBe(false);
  });
});
