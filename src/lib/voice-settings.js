export const VOICE_SETTINGS_STORAGE_KEY = 'issue-note.voice-settings.v1';
export const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-transcribe';
export const DEFAULT_REFINEMENT_MODEL = 'gpt-4o-mini';

export function loadVoiceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY) || '{}');
    return {
      apiKey: String(saved.apiKey || ''),
      refinementPrompt: String(saved.refinementPrompt || ''),
      // 설정에서 명시적으로 비워 둔 값은 그대로 보존한다. 실제 요청 직전에
      // 기본 모델을 적용하므로, UI는 사용자의 "기본값 사용" 의도를 보여줄 수 있다.
      transcriptionModel: saved.transcriptionModel == null
        ? DEFAULT_TRANSCRIPTION_MODEL
        : String(saved.transcriptionModel).trim(),
      refinementModel: saved.refinementModel == null
        ? DEFAULT_REFINEMENT_MODEL
        : String(saved.refinementModel).trim()
    };
  } catch {
    return { apiKey: '', refinementPrompt: '', transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL, refinementModel: DEFAULT_REFINEMENT_MODEL };
  }
}

export function saveVoiceSettings({ apiKey, refinementPrompt, transcriptionModel, refinementModel }) {
  localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify({
    apiKey: String(apiKey || '').trim(),
    refinementPrompt: String(refinementPrompt || '').trim(),
    transcriptionModel: transcriptionModel == null
      ? DEFAULT_TRANSCRIPTION_MODEL
      : String(transcriptionModel).trim(),
    refinementModel: refinementModel == null
      ? DEFAULT_REFINEMENT_MODEL
      : String(refinementModel).trim()
  }));
}
