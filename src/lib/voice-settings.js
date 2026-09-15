export const VOICE_SETTINGS_STORAGE_KEY = 'issue-note.voice-settings.v1';
export const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-transcribe';
export const DEFAULT_REFINEMENT_MODEL = 'gpt-4o-mini';
export const TYPO_CORRECTION_REFINEMENT_PROMPT = `- 전사 오류와 오타, 띄어쓰기, 문장부호를 자연스럽게 정리합니다.
- 의미 단위가 드러나도록 필요한 곳에만 문단 구분 줄바꿈을 넣습니다.
- 원문의 의미와 말투를 유지하고, 불확실한 내용은 추측해 고치지 않습니다.
- 요약·재서술·내용 추가 없이, 애매하면 원문을 유지합니다.`;

export const WRITTEN_STYLE_REFINEMENT_PROMPT = `목적: 두서없이 말한 음성 발화를, 화자가 실제로 전달하려던 내용을 빠짐없이 담은 자연스러운 기록문으로 만듭니다. 요약하거나 새 글을 쓰지 말고 발화의 뜻을 보존합니다.

- 사실·판단·감정·요청·불확실성의 정도·시제·인물·말투를 유지합니다. 원문에 없는 내용은 보태지 않고, 애매하면 그대로 둡니다.
- 기록의 의미에 기여하지 않는 추임새, 단순 머뭇거림, 문장을 찾으며 생긴 끊김, 뜻이 같은 단순 반복만 정리합니다. 삭제하면 확신·감정·대조·강조·횟수의 의미가 달라지는 표현은 남깁니다.
- 뒤 표현이 앞 표현을 명백히 부정하거나 같은 자리를 대체할 때만 앞 표현을 지우고 최종 표현을 기록합니다. 이유·범위·우선순위를 보태거나 관점을 바꾼 말은 모두 남기며, 판단이 애매하면 삭제하지 않습니다.
- 명백한 전사 오류·오타만 고치고, 확신할 수 없는 단어·고유명사·숫자는 바꾸지 않습니다. 띄어쓰기·문장부호·어순은 뜻을 바꾸지 않는 범위에서 다듬습니다.
- 내용은 빠뜨리지 않고, 의미상 문단을 구분합니다. 한 문단의 크기가 너무 길어지지 않게 합니다. 정제된 기록문만 출력합니다.`;

// 기존 저장값 및 외부 사용처와의 호환성을 위해 기본 프롬프트 이름은 유지한다.
export const DEFAULT_REFINEMENT_PROMPT = TYPO_CORRECTION_REFINEMENT_PROMPT;
export const VOICE_MODEL_LIST_STORAGE_KEY = 'issue-note.voice-models.v1';
export const VOICE_HINTS_PENDING_STORAGE_KEY = 'issue-note.voice-hints-pending.v1';

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

function loadPendingVoiceHintsStore() {
  try {
    const value = JSON.parse(localStorage.getItem(VOICE_HINTS_PENDING_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// A pending value is intentionally keyed by repository so an interrupted
// settings edit cannot be applied to a different workspace on the next launch.
export function loadPendingVoiceTranscriptionHints(repo) {
  const key = String(repo || '').trim();
  if (!key) return null;
  const store = loadPendingVoiceHintsStore();
  return Object.hasOwn(store, key) ? String(store[key] || '') : null;
}

export function savePendingVoiceTranscriptionHints(repo, hints) {
  const key = String(repo || '').trim();
  if (!key) return;
  try {
    const store = loadPendingVoiceHintsStore();
    store[key] = String(hints || '');
    localStorage.setItem(VOICE_HINTS_PENDING_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // The repository save still runs when settings close if local backup fails.
  }
}

export function clearPendingVoiceTranscriptionHints(repo) {
  const key = String(repo || '').trim();
  if (!key) return;
  try {
    const store = loadPendingVoiceHintsStore();
    if (!Object.hasOwn(store, key)) return;
    delete store[key];
    localStorage.setItem(VOICE_HINTS_PENDING_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Leaving an already-applied backup behind only causes a harmless retry.
  }
}
