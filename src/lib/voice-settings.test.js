import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REFINEMENT_PROMPT,
  loadVoiceModelLists,
  loadVoiceSettings,
  saveVoiceModelLists,
  saveVoiceSettings,
  VOICE_MODEL_LIST_STORAGE_KEY,
  VOICE_SETTINGS_STORAGE_KEY
} from './voice-settings.js';

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
    expect(loadVoiceSettings()).toEqual({ apiKey: '', refinementPrompt: DEFAULT_REFINEMENT_PROMPT, transcriptionModel: 'gpt-transcribe', refinementModel: 'gpt-4o-mini', preserveOriginalAudio: false });
    localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, '{');
    expect(loadVoiceSettings()).toEqual({ apiKey: '', refinementPrompt: DEFAULT_REFINEMENT_PROMPT, transcriptionModel: 'gpt-transcribe', refinementModel: 'gpt-4o-mini', preserveOriginalAudio: false });
  });

  it('API 키와 정제 프롬프트를 공백 제거 후 저장한다', () => {
    saveVoiceSettings({ apiKey: ' sk-test ', refinementPrompt: '  용어를 유지하세요.  ' });
    expect(loadVoiceSettings()).toEqual({ apiKey: 'sk-test', refinementPrompt: '용어를 유지하세요.', transcriptionModel: 'gpt-transcribe', refinementModel: 'gpt-4o-mini', preserveOriginalAudio: false });
  });

  it('비운 모델명은 설정에 그대로 보존한다', () => {
    saveVoiceSettings({ apiKey: '', refinementPrompt: '', transcriptionModel: '  ', refinementModel: '' });
    expect(loadVoiceSettings()).toMatchObject({
      transcriptionModel: '',
      refinementModel: ''
    });
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

  it('원본 음성 보존은 기본적으로 끄고 명시적으로 켤 수 있다', () => {
    saveVoiceSettings({ apiKey: '', refinementPrompt: '', preserveOriginalAudio: true });
    expect(loadVoiceSettings().preserveOriginalAudio).toBe(true);
  });

  it('가져온 모델 목록을 중복 없이 별도 캐시에 보관한다', () => {
    saveVoiceModelLists({
      transcription: ['gpt-transcribe', 'gpt-transcribe', 'gpt-4o-transcribe', 'gpt-4o-transcribe-2025-03-20'],
      refinement: ['gpt-4o-mini', 'gpt-4o', 'gpt-4o-2024-08-06']
    });

    expect(loadVoiceModelLists()).toEqual({
      transcription: ['gpt-transcribe', 'gpt-4o-transcribe'],
      refinement: ['gpt-4o-mini', 'gpt-4o']
    });
  });

  it('손상된 모델 목록 캐시에는 기본 목록을 사용한다', () => {
    localStorage.setItem(VOICE_MODEL_LIST_STORAGE_KEY, '{');
    expect(loadVoiceModelLists().transcription).toContain('gpt-transcribe');
    expect(loadVoiceModelLists().refinement).toContain('gpt-4o-mini');
  });

  it('날짜가 붙은 모델 스냅샷은 캐시 목록에서 제외한다', () => {
    localStorage.setItem(VOICE_MODEL_LIST_STORAGE_KEY, JSON.stringify({
      transcription: ['gpt-transcribe-2025-01-01'],
      refinement: ['gpt-4.1-2025-04-14']
    }));

    expect(loadVoiceModelLists()).toEqual({
      transcription: [],
      refinement: []
    });
  });
});
