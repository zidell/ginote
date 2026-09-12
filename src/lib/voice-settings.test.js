import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadVoiceSettings, saveVoiceSettings, VOICE_SETTINGS_STORAGE_KEY } from './voice-settings.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
}

beforeEach(() => vi.stubGlobal('localStorage', createMemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('voice settings', () => {
  it('비어 있거나 손상된 저장값에는 안전한 기본값을 사용한다', () => {
    expect(loadVoiceSettings()).toEqual({ apiKey: '', refinementPrompt: '', transcriptionModel: 'whisper-1', refinementModel: 'gpt-4o-mini' });
    localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, '{');
    expect(loadVoiceSettings()).toEqual({ apiKey: '', refinementPrompt: '', transcriptionModel: 'whisper-1', refinementModel: 'gpt-4o-mini' });
  });

  it('API 키와 정제 프롬프트를 공백 제거 후 저장한다', () => {
    saveVoiceSettings({ apiKey: ' sk-test ', refinementPrompt: '  용어를 유지하세요.  ' });
    expect(loadVoiceSettings()).toEqual({ apiKey: 'sk-test', refinementPrompt: '용어를 유지하세요.', transcriptionModel: 'whisper-1', refinementModel: 'gpt-4o-mini' });
  });

  it('새로 나온 모델 ID도 제한 없이 저장한다', () => {
    saveVoiceSettings({
      apiKey: '', refinementPrompt: '',
      transcriptionModel: 'future-transcribe-model',
      refinementModel: 'future-text-model'
    });
    expect(loadVoiceSettings().transcriptionModel).toBe('future-transcribe-model');
    expect(loadVoiceSettings().refinementModel).toBe('future-text-model');
  });
});
