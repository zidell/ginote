const OPENAI_API_ROOT = 'https://api.openai.com/v1';

async function readResponse(response) {
  if (response.ok) return response.json();
  let message = '';
  try { message = (await response.json())?.error?.message || ''; } catch { /* use status below */ }
  throw new Error(message || `OpenAI 요청에 실패했습니다. (${response.status})`);
}

function authorization(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function transcribeAudio(apiKey, audio, model = 'gpt-4o-transcribe', signal) {
  const form = new FormData();
  form.append('model', model);
  form.append('language', 'ko');
  form.append('response_format', 'json');
  const extension = audio.type.includes('mp4') ? 'mp4' : 'webm';
  form.append('file', audio, `recording.${extension}`);
  const response = await fetch(`${OPENAI_API_ROOT}/audio/transcriptions`, {
    method: 'POST', headers: authorization(apiKey), body: form, signal
  });
  const payload = await readResponse(response);
  return String(payload.text || '').trim();
}

export async function refineTranscript(apiKey, transcript, refinementPrompt = '', model = 'gpt-4o-mini', signal) {
  const instructions = refinementPrompt.trim()
    || '다음 음성 전사문에서 오타, 잘못 인식된 단어, 문장부호만 자연스럽게 정정하세요. 내용은 요약하거나 덧붙이지 말고, 정정된 본문만 반환하세요.';
  const response = await fetch(`${OPENAI_API_ROOT}/chat/completions`, {
    method: 'POST',
    headers: { ...authorization(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, temperature: 0,
      messages: [{ role: 'system', content: instructions }, { role: 'user', content: transcript }]
    }), signal
  });
  const payload = await readResponse(response);
  return String(payload.choices?.[0]?.message?.content || transcript).trim();
}
