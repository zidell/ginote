export const VOICE_SETTINGS_STORAGE_KEY = 'issue-note.voice-settings.v1';
export const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-transcribe';
export const DEFAULT_REFINEMENT_MODEL = 'gpt-4o-mini';
export const TYPO_CORRECTION_REFINEMENT_PROMPT = `목적: 전사문을 거의 그대로 유지하면서 정확하고 읽기 편하게 다듬습니다.

- 확실한 전사 오류·오타, 띄어쓰기, 문장부호만 자연스럽게 바로잡습니다.
- 원문의 의미·말투·정보량·불확실성은 그대로 보존합니다.
- 의미 단위가 드러나는 곳에만 문단을 나누고, 판단이 어려운 표현은 원문대로 둡니다.`;

export const WRITTEN_STYLE_REFINEMENT_PROMPT = `목적: 두서없이 말한 음성 발화를, 화자가 전달하려던 내용을 빠짐없이 담은 자연스러운 기록문으로 만듭니다.

- 사실·판단·감정·요청·불확실성의 정도·시제·인물·말투를 보존하고, 원문에서 확인되는 정보만 사용합니다.
- 의미를 이루는 표현을 중심으로 문장을 만들고, 단순 추임새·머뭇거림·말을 찾는 끊김·같은 뜻의 반복은 자연스럽게 정리합니다. 확신·감정·대조·강조·횟수의 의미는 살립니다.
- 앞말을 명백히 수정하거나 대체한 최종 표현을 반영하고, 이유·범위·우선순위·관점의 변화는 모두 담습니다.
- 확실한 전사 오류만 바로잡고, 애매한 단어·고유명사·숫자는 원문대로 둡니다. 의미에 맞게 문장과 문단을 매끄럽게 구성합니다.`;

export const CONCLUSION_FOCUSED_REFINEMENT_PROMPT = `목적: 두서없이 길게 말한 음성 발화 전체를 이해해, 화자가 최종적으로 남기려는 생각을 결론·결정·요청과 핵심 근거가 또렷한 기록문으로 구성합니다.

- 전사문 전체에서 화자의 최종 입장, 결정 사항, 요청, 해야 할 일과 핵심 이유를 파악합니다. 발화의 흐름과 순서를 기본으로 삼고, 흩어진 근거와 결론을 연결하거나 시간 흐름을 분명히 할 때만 필요한 범위에서 재배열합니다.
- 생각을 수정하거나 대체한 경우 최종 표현을 반영합니다. 반복·말실수·말을 찾는 과정·철회된 표현은 덜어 내고, 서로 다른 이유·조건·우선순위·예외·감정·강조는 구분해 담습니다.
- 결론이 열려 있으면 남아 있는 선택지와 보류 상태를 간결하게 기록합니다.
- 원문에서 확인되는 사실·의도·관계만으로 구성하며, 확실하지 않은 단어·고유명사·숫자·날짜는 원문대로 둡니다.
- 화자의 말투와 의도, 단호함·망설임·감정의 정도를 살린 자연스럽고 매끄러운 기록문으로 씁니다.`;

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
