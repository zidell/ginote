export const VOICE_SETTINGS_STORAGE_KEY = 'issue-note.voice-settings.v1';

export function loadVoiceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY) || '{}');
    return {
      apiKey: String(saved.apiKey || ''),
      refinementPrompt: String(saved.refinementPrompt || ''),
      transcriptionModel: String(saved.transcriptionModel || 'whisper-1'),
      refinementModel: String(saved.refinementModel || 'gpt-4o-mini')
    };
  } catch {
    return { apiKey: '', refinementPrompt: '', transcriptionModel: 'whisper-1', refinementModel: 'gpt-4o-mini' };
  }
}

export function saveVoiceSettings({ apiKey, refinementPrompt, transcriptionModel, refinementModel }) {
  localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify({
    apiKey: String(apiKey || '').trim(),
    refinementPrompt: String(refinementPrompt || '').trim(),
    transcriptionModel: String(transcriptionModel || 'whisper-1').trim(),
    refinementModel: String(refinementModel || 'gpt-4o-mini').trim()
  }));
}
