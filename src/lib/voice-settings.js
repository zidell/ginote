export const VOICE_SETTINGS_STORAGE_KEY = 'issue-note.voice-settings.v1';
export const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-transcribe';
export const DEFAULT_REFINEMENT_MODEL = 'gpt-4o-mini';
export const TYPO_CORRECTION_REFINEMENT_PROMPT = `- 전사 오류와 오타, 띄어쓰기, 문장부호를 자연스럽게 정리합니다.
- 의미 단위가 드러나도록 필요한 곳에만 문단 구분 줄바꿈을 넣습니다.
- 원문의 의미와 말투를 유지하고, 불확실한 내용은 추측해 고치지 않습니다.
- 요약·재서술·내용 추가 없이, 애매하면 원문을 유지합니다.`;

export const WRITTEN_STYLE_REFINEMENT_PROMPT = `- 전사 오류와 오타, 띄어쓰기, 문장부호를 자연스럽게 정리합니다.
- “어”, “음”, “그”, “저기”, “뭐지” 같은 의미 없는 추임새·머뭇거림과 말버릇은 제거합니다.
- 말하다가 취소하거나 바로 고쳐 말한 부분은 앞선 표현을 버리고, 문맥상 분명한 최종 의도로 정리합니다.
- 불필요한 반복, 말문을 여는 표현, 끊긴 어순을 정리해 자연스럽고 읽기 쉬운 문장으로 다시 씁니다.
- 원문의 사실, 시제, 인물, 존댓말·반말, 확실성의 정도는 유지합니다. 원인이나 의도를 추측해 보태거나, 애매한 내용을 단정하지 않습니다.
- 핵심 내용을 빠뜨리거나 요약하지 말고, 읽기 쉬운 문단으로 적극적으로 나눕니다. 시간·주제·상황·행동 단계가 바뀌거나 하나의 생각이 끝나면 빈 줄로 문단을 구분합니다. 단, 짧게 이어지는 같은 맥락의 문장은 억지로 나누지 않습니다.`;

// 기존 저장값 및 외부 사용처와의 호환성을 위해 기본 프롬프트 이름은 유지한다.
export const DEFAULT_REFINEMENT_PROMPT = TYPO_CORRECTION_REFINEMENT_PROMPT;
export const VOICE_MODEL_LIST_STORAGE_KEY = 'issue-note.voice-models.v1';

export const DEFAULT_VOICE_MODEL_LISTS = {
  transcription: ['gpt-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe'],
  refinement: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']
};

export function isDatedModelSnapshot(model) {
  return /-\d{4}-\d{2}-\d{2}(?:$|[-_])/.test(String(model || '').trim());
}

export function loadVoiceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY) || '{}');
    return {
      apiKey: String(saved.apiKey || ''),
      refinementPrompt: String(saved.refinementPrompt || DEFAULT_REFINEMENT_PROMPT),
      // 빈 값은 UI에서 "없음"을 뜻하며, 녹음 완료 시 정제 호출을 하지 않는다.
      transcriptionModel: saved.transcriptionModel == null
        ? DEFAULT_TRANSCRIPTION_MODEL
        : String(saved.transcriptionModel).trim(),
      refinementModel: saved.refinementModel == null
        ? DEFAULT_REFINEMENT_MODEL
        : String(saved.refinementModel).trim(),
      preserveOriginalAudio: Boolean(saved.preserveOriginalAudio)
    };
  } catch {
    return { apiKey: '', refinementPrompt: DEFAULT_REFINEMENT_PROMPT, transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL, refinementModel: DEFAULT_REFINEMENT_MODEL, preserveOriginalAudio: false };
  }
}

export function saveVoiceSettings({ apiKey, refinementPrompt, transcriptionModel, refinementModel, preserveOriginalAudio = false }) {
  localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify({
    apiKey: String(apiKey || '').trim(),
    refinementPrompt: String(refinementPrompt || DEFAULT_REFINEMENT_PROMPT).trim(),
    transcriptionModel: transcriptionModel == null
      ? DEFAULT_TRANSCRIPTION_MODEL
      : String(transcriptionModel).trim(),
    refinementModel: refinementModel == null
      ? DEFAULT_REFINEMENT_MODEL
      : String(refinementModel).trim(),
    preserveOriginalAudio: Boolean(preserveOriginalAudio)
  }));
}

function uniqueModels(models, fallback) {
  const values = Array.isArray(models) ? models : fallback;
  return [...new Set(values
    .map((model) => String(model || '').trim())
    .filter((model) => model && !isDatedModelSnapshot(model)))];
}

export function loadVoiceModelLists() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_MODEL_LIST_STORAGE_KEY) || '{}');
    return {
      transcription: uniqueModels(saved.transcription, DEFAULT_VOICE_MODEL_LISTS.transcription),
      refinement: uniqueModels(saved.refinement, DEFAULT_VOICE_MODEL_LISTS.refinement)
    };
  } catch {
    return {
      transcription: [...DEFAULT_VOICE_MODEL_LISTS.transcription],
      refinement: [...DEFAULT_VOICE_MODEL_LISTS.refinement]
    };
  }
}

export function saveVoiceModelLists({ transcription, refinement }) {
  localStorage.setItem(VOICE_MODEL_LIST_STORAGE_KEY, JSON.stringify({
    transcription: uniqueModels(transcription, DEFAULT_VOICE_MODEL_LISTS.transcription),
    refinement: uniqueModels(refinement, DEFAULT_VOICE_MODEL_LISTS.refinement)
  }));
}
