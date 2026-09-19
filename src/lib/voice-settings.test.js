import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REFINEMENT_PROMPT,
  TYPO_CORRECTION_REFINEMENT_PROMPT,
  WRITTEN_STYLE_REFINEMENT_PROMPT,
  CONCLUSION_FOCUSED_REFINEMENT_PROMPT,
  clearPendingVoiceTranscriptionHints,
  loadPendingVoiceTranscriptionHints,
  loadVoiceModelLists,
  loadVoiceSettings,
  savePendingVoiceTranscriptionHints,
  saveVoiceModelLists,
  saveVoiceSettings,
  VOICE_HINTS_PENDING_STORAGE_KEY,
  VOICE_MODEL_LIST_STORAGE_KEY,
  VOICE_SETTINGS_STORAGE_KEY,
  classifyVoiceModels,
  maskApiKey,
  withSelectedModels
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
  it('약함·중간·강함에 서로 다른 목적의 내장 규칙을 제공한다', () => {
    expect(DEFAULT_REFINEMENT_PROMPT).toBe(TYPO_CORRECTION_REFINEMENT_PROMPT);
    expect(TYPO_CORRECTION_REFINEMENT_PROMPT).toContain('원문의 의미·말투·정보량·불확실성은 그대로 보존');
    expect(WRITTEN_STYLE_REFINEMENT_PROMPT).toContain('전달하려던 내용을 빠짐없이 담은 자연스러운 기록문');
    expect(WRITTEN_STYLE_REFINEMENT_PROMPT).toContain('의미를 이루는 표현을 중심으로 문장을 만들고');
    expect(WRITTEN_STYLE_REFINEMENT_PROMPT).toContain('불확실성의 정도');
    expect(WRITTEN_STYLE_REFINEMENT_PROMPT).toContain('최종 표현을 반영');
    expect(WRITTEN_STYLE_REFINEMENT_PROMPT).toContain('애매한 단어·고유명사·숫자는 원문대로 둡니다');
    expect(WRITTEN_STYLE_REFINEMENT_PROMPT).toContain('말투를 보존');
    expect(WRITTEN_STYLE_REFINEMENT_PROMPT).toContain('원문에서 확인되는 정보만 사용');
    expect(CONCLUSION_FOCUSED_REFINEMENT_PROMPT).toContain('최종적으로 남기려는 생각을 결론·결정·요청과 핵심 근거');
    expect(CONCLUSION_FOCUSED_REFINEMENT_PROMPT).toContain('발화의 흐름과 순서를 기본으로 삼고');
    expect(CONCLUSION_FOCUSED_REFINEMENT_PROMPT).toContain('필요한 범위에서 재배열');
    expect(CONCLUSION_FOCUSED_REFINEMENT_PROMPT).toContain('최종 표현을 반영');
    expect(CONCLUSION_FOCUSED_REFINEMENT_PROMPT).toContain('선택지와 보류 상태를 간결하게 기록');
    expect(CONCLUSION_FOCUSED_REFINEMENT_PROMPT).toContain('원문에서 확인되는 사실·의도·관계만으로 구성');
    expect(CONCLUSION_FOCUSED_REFINEMENT_PROMPT).toContain('자연스럽고 매끄러운 기록문');
    expect(CONCLUSION_FOCUSED_REFINEMENT_PROMPT).toContain('말투와 의도');
  });

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

  it('미처리 전사 단어는 저장소별로 보관하고 반영 뒤 지운다', () => {
    savePendingVoiceTranscriptionHints('owner/one', 'Ginote, 지델');
    savePendingVoiceTranscriptionHints('owner/two', 'Svelte');
    expect(loadPendingVoiceTranscriptionHints('owner/one')).toBe('Ginote, 지델');
    expect(loadPendingVoiceTranscriptionHints('owner/two')).toBe('Svelte');
    clearPendingVoiceTranscriptionHints('owner/one');
    expect(loadPendingVoiceTranscriptionHints('owner/one')).toBeNull();
    expect(JSON.parse(localStorage.getItem(VOICE_HINTS_PENDING_STORAGE_KEY))).toEqual({ 'owner/two': 'Svelte' });
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

describe('음성 모델 목록', () => {
  it('OpenAI 모델을 전사용과 정제용으로 나누고 날짜 스냅샷과 특수 모델은 뺀다', () => {
    const lists = classifyVoiceModels([
      'gpt-4o-transcribe',
      'gpt-4o-mini-transcribe',
      'whisper-1',
      'gpt-4o-transcribe-2025-03-20',
      'gpt-4o',
      'gpt-5-mini',
      'o3',
      'gpt-4o-audio-preview',
      'gpt-4o-realtime-preview',
      'tts-1',
      'text-embedding-3-small',
      'gpt-4o'
    ]);
    expect(lists.transcription).toEqual(['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1']);
    expect(lists.refinement).toEqual(['gpt-4o', 'gpt-5-mini', 'o3']);
  });

  it('선택 중인 모델이 새 목록에 없으면 남겨 둔다', () => {
    const lists = withSelectedModels(
      { transcription: ['whisper-1'], refinement: ['gpt-4o'] },
      { transcriptionModel: 'gpt-transcribe', refinementModel: 'a-custom-model' }
    );
    expect(lists).toEqual({ transcription: ['gpt-transcribe', 'whisper-1'], refinement: ['a-custom-model', 'gpt-4o'] });
  });

  it('날짜 스냅샷이나 빈 선택은 목록에 더하지 않고, 원본 목록도 바꾸지 않는다', () => {
    const original = { transcription: ['whisper-1'], refinement: ['gpt-4o'] };
    const lists = withSelectedModels(original, { transcriptionModel: 'gpt-4o-transcribe-2025-03-20', refinementModel: '' });
    expect(lists).toEqual(original);
    expect(lists.transcription).not.toBe(original.transcription);
  });
});

describe('maskApiKey', () => {
  it('긴 키는 앞뒤 10자만 보여 주고 짧은 키는 모두 가린다', () => {
    expect(maskApiKey('sk-proj-1234567890abcdefghij')).toBe('sk-proj-12...abcdefghij');
    expect(maskApiKey('sk-short')).toBe('••••••••••••');
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey(null)).toBe('');
  });
});
