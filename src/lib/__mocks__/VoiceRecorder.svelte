<script>
  // App 테스트에서 쓰는 녹음기 대역이다. 마이크 없이 녹음 완료를 흉내 낸다.
  // 완료 결과는 테스트가 globalThis.__voiceRecording에 넣어 둔다.
  export let apiKey = '';
  export let refinementPrompt = '';
  export let transcriptionModel = '';
  export let transcriptionLanguage = '';
  export let transcriptionHints = '';
  export let refinementModel = '';
  export let availableTags = [];
  export let onComplete = async () => {};
  export let onClose = () => {};
  export let onDirtyChange = () => {};

  function complete() {
    const { body = '', tags = [], title = '' } = globalThis.__voiceRecording || {};
    onDirtyChange(false);
    return onComplete(body, new Blob(['audio'], { type: 'audio/webm' }), tags, title);
  }
</script>

<div
  data-testid="voice-recorder"
  data-api-key={apiKey}
  data-hints={transcriptionHints}
  data-tags={availableTags.map((tag) => tag.name).join(',')}
  data-models={`${transcriptionModel}|${refinementModel}|${transcriptionLanguage}|${refinementPrompt.length}`}
>
  <button type="button" on:click={complete}>녹음 완료</button>
  <button type="button" on:click={() => onDirtyChange(true)}>녹음 시작</button>
  <button type="button" on:click={onClose}>녹음 닫기</button>
</div>
