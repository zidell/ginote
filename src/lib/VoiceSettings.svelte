<script>
  import { onDestroy, tick } from 'svelte';
  import { listAvailableVoiceModels } from './openai-voice.js';
  import {
    CONCLUSION_FOCUSED_REFINEMENT_PROMPT,
    TYPO_CORRECTION_REFINEMENT_PROMPT,
    WRITTEN_STYLE_REFINEMENT_PROMPT,
    classifyVoiceModels,
    loadVoiceModelLists,
    maskApiKey,
    saveVoiceModelLists,
    saveVoiceSettings,
    withSelectedModels
  } from './voice-settings.js';

  const MODEL_REFRESH_DELAY_MS = 600;
  const HIGHLIGHT_MS = 1800;

  export let apiKey = '';
  export let refinementPrompt = '';
  export let transcriptionModel = '';
  export let refinementModel = '';
  export let preserveOriginalAudio = false;
  export let transcriptionHints = '';
  export let hintsLoading = false;
  export let hintsError = '';
  export let onHintsInput = () => {};

  let modelLists = loadVoiceModelLists();
  let modelsRefreshing = false;
  let modelsError = '';
  let modelsRefreshTimer = null;
  let modelsAbortController;
  let fetchedApiKey = '';
  let apiKeyEditing = false;
  let highlighted = false;
  let highlightTimer;
  let section;
  let apiKeyInput;

  onDestroy(() => {
    clearTimeout(highlightTimer);
    // 키를 입력하자마자 환경설정을 닫아도 예약해 둔 모델 목록 갱신은 마저 한다.
    if (modelsRefreshTimer) {
      clearTimeout(modelsRefreshTimer);
      modelsRefreshTimer = null;
      void refreshModelLists();
    }
  });

  // 음성 녹음 버튼에서 키가 없어 넘어왔을 때 API 키 입력란을 강조한다.
  export async function focusApiKey() {
    await tick();
    highlighted = true;
    section?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    apiKeyInput?.focus();
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => highlighted = false, HIGHLIGHT_MS);
  }

  function persist() {
    saveVoiceSettings({ apiKey, refinementPrompt, transcriptionModel, refinementModel, preserveOriginalAudio });
  }

  function applyPreset(prompt) {
    refinementPrompt = prompt;
    persist();
  }

  function handleApiKeyInput(event) {
    const previousKey = apiKey.trim();
    apiKey = event.currentTarget.value;
    persist();
    if (apiKey.trim() && apiKey.trim() !== previousKey) scheduleModelRefresh();
  }

  function handleHintsInput(event) {
    onHintsInput(event.currentTarget.value);
  }

  async function refreshModelLists() {
    const requestedApiKey = apiKey.trim();
    if (!requestedApiKey || modelsRefreshing) return;
    modelsAbortController?.abort();
    modelsAbortController = new AbortController();
    modelsRefreshing = true;
    modelsError = '';
    try {
      const lists = withSelectedModels(
        classifyVoiceModels(await listAvailableVoiceModels(requestedApiKey, modelsAbortController.signal)),
        { transcriptionModel, refinementModel }
      );
      modelLists = lists;
      saveVoiceModelLists(lists);
      fetchedApiKey = requestedApiKey;
    } catch (reason) {
      if (reason?.name !== 'AbortError') modelsError = reason?.message || '모델 목록을 가져오지 못했습니다.';
    } finally {
      if (modelsAbortController?.signal.aborted === false) modelsAbortController = null;
      modelsRefreshing = false;
    }
  }

  function scheduleModelRefresh() {
    const requestedApiKey = apiKey.trim();
    if (!requestedApiKey || requestedApiKey === fetchedApiKey) return;
    clearTimeout(modelsRefreshTimer);
    modelsRefreshTimer = setTimeout(() => {
      modelsRefreshTimer = null;
      void refreshModelLists();
    }, MODEL_REFRESH_DELAY_MS);
  }
</script>

<fieldset class="editor-settings voice-settings mb-4" class:is-highlighted={highlighted} bind:this={section}>
  <legend>음성 녹음</legend>
  <label class="form-label" for="voice-api-key">OpenAI API 키</label>
  <input
    id="voice-api-key"
    class="form-control"
    type={apiKeyEditing ? 'password' : 'text'}
    autocomplete="off"
    placeholder="sk-..."
    bind:this={apiKeyInput}
    value={apiKeyEditing ? apiKey : maskApiKey(apiKey)}
    readonly={!apiKeyEditing}
    aria-label="OpenAI API 키"
    on:input={handleApiKeyInput}
    on:focus={() => apiKeyEditing = true}
    on:blur={() => apiKeyEditing = false}
  />
  <div class="settings-help-note">녹음과 전사문은 OpenAI로 직접 전송됩니다. 키는 이 기기의 localStorage에 평문으로 저장되므로 전용 프로젝트 키·사용 한도·정기 교체를 권장합니다.</div>
  <div class="row g-2 mt-2">
    <div class="col-sm-6">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <label class="form-label mb-0" for="voice-transcription-model">음성 전사 모델</label>
        <button type="button" class="btn btn-link p-0 voice-label-action" on:click={refreshModelLists} disabled={!apiKey.trim() || modelsRefreshing} title="모델 목록 새로고침" aria-label="모델 목록 새로고침">
          <i class:spin={modelsRefreshing} class="bi bi-arrow-clockwise" aria-hidden="true"></i>
        </button>
      </div>
      <select id="voice-transcription-model" class="form-select" bind:value={transcriptionModel} on:change={persist}>
        {#each modelLists.transcription as model}
          <option value={model}>{model}</option>
        {/each}
      </select>
    </div>
    <div class="col-sm-6">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <label class="form-label mb-0" for="voice-refinement-model">텍스트 정제 모델</label>
        <button type="button" class="btn btn-link p-0 voice-label-action" on:click={refreshModelLists} disabled={!apiKey.trim() || modelsRefreshing} title="모델 목록 새로고침" aria-label="모델 목록 새로고침">
          <i class:spin={modelsRefreshing} class="bi bi-arrow-clockwise" aria-hidden="true"></i>
        </button>
      </div>
      <select id="voice-refinement-model" class="form-select" bind:value={refinementModel} on:change={persist}>
        <option value="">없음</option>
        {#each modelLists.refinement as model}
          <option value={model}>{model}</option>
        {/each}
      </select>
    </div>
  </div>
  <div class="form-check mt-3">
    <input id="voice-preserve-original" class="form-check-input" type="checkbox" bind:checked={preserveOriginalAudio} on:change={persist} />
    <label class="form-check-label" for="voice-preserve-original">원본 음성 보존</label>
    <div class="settings-help-note">녹음이 성공하면 해당 노트의 첨부파일로 원본 음성을 저장합니다.</div>
  </div>
  {#if modelsError}<div class="text-danger small mt-2" role="alert">{modelsError}</div>{/if}
  {#if refinementModel.trim()}
    <div class="d-flex align-items-center justify-content-between mt-3 mb-2">
      <label class="form-label mb-0" for="voice-refinement-prompt">정제 규칙</label>
      <div class="voice-refinement-presets" aria-label="정제 규칙 프리셋">
        <button
          type="button"
          class="btn btn-link p-0 voice-label-action voice-default-action"
          on:click={() => applyPreset(TYPO_CORRECTION_REFINEMENT_PROMPT)}
        >약함</button>
        <span class="voice-preset-separator" aria-hidden="true">|</span>
        <button
          type="button"
          class="btn btn-link p-0 voice-label-action voice-default-action"
          on:click={() => applyPreset(WRITTEN_STYLE_REFINEMENT_PROMPT)}
        >중간</button>
        <span class="voice-preset-separator" aria-hidden="true">|</span>
        <button
          type="button"
          class="btn btn-link p-0 voice-label-action voice-default-action"
          on:click={() => applyPreset(CONCLUSION_FOCUSED_REFINEMENT_PROMPT)}
        >강함</button>
      </div>
    </div>
    <textarea
      id="voice-refinement-prompt"
      class="form-control"
      rows="5"
      maxlength="1000"
      bind:value={refinementPrompt}
      on:input={persist}
    ></textarea>
  {/if}
  <div class="mt-3">
    <label class="form-label" for="voice-transcription-hints">자주 쓰는 전사 단어</label>
    <input
      id="voice-transcription-hints"
      class="form-control"
      type="text"
      maxlength="3000"
      placeholder="Ginote, Svelte, OpenAI, 프로젝트명"
      bind:value={transcriptionHints}
      disabled={hintsLoading}
      on:input={handleHintsInput}
    />
    {#if hintsError}<div class="text-danger small mt-1" role="alert">{hintsError}</div>{/if}
  </div>
</fieldset>
