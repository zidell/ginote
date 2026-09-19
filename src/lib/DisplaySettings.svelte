<script>
  import { _ } from 'svelte-i18n';
  import {
    CODING_FONT_OPTIONS,
    isWebFont,
    loadWebFont,
    localFontFamily,
    localFontValue
  } from './editor-fonts.js';
  import { LOCALE_OPTIONS, setAppLocale } from './i18n.js';
  import {
    LOCK_SESSION_OPTIONS,
    THEME_OPTIONS,
    WORKSPACE_CACHE_OPTIONS,
    applyTheme
  } from './settings-storage.js';

  // 입력값은 바로 반영하고, 범위 보정과 저장은 환경설정을 닫을 때 한다.
  export let preferences;
  export let onDeferredChange = () => {};

  let localFontFamilies = [];
  let localFontLoadState = 'idle';

  $: selectedLocalFont = localFontFamily(preferences.editorFont);
  $: visibleLocalFontFamilies = [...new Set([
    ...localFontFamilies,
    ...(selectedLocalFont ? [selectedLocalFont] : [])
  ])].sort((left, right) => left.localeCompare(right));

  function handleThemeChange() {
    preferences.theme = applyTheme(preferences.theme);
    onDeferredChange();
  }

  function handleEditorFontChange(event) {
    onDeferredChange();
    const selectedFont = event.currentTarget?.value || preferences.editorFont;
    if (isWebFont(selectedFont)) void loadWebFont(selectedFont);
  }

  async function loadLocalFonts() {
    if (localFontLoadState === 'loading') return;
    if (typeof window.queryLocalFonts !== 'function') {
      localFontLoadState = 'unsupported';
      return;
    }

    localFontLoadState = 'loading';
    try {
      const faces = await window.queryLocalFonts();
      localFontFamilies = [...new Set(
        faces.map((face) => String(face.family || '').trim()).filter(Boolean)
      )].sort((left, right) => left.localeCompare(right));
      localFontLoadState = 'ready';
    } catch {
      // 권한 거부와 보안 컨텍스트 오류 모두 사용자가 다시 시도할 수 있게 처리한다.
      localFontLoadState = 'unavailable';
    }
  }
</script>

<fieldset class="editor-settings mb-4">
  <legend>{$_("m.cf8e8136d8")}</legend>
  <div class="mb-3">
    <label class="form-label" for="theme">{$_('settings.theme')}</label>
    <select
      id="theme"
      class="form-select"
      bind:value={preferences.theme}
      on:change={handleThemeChange}
    >
      {#each THEME_OPTIONS as option}
        <option value={option}>{$_(`settings.theme${option === 'dark' ? 'Dark' : 'Light'}`)}</option>
      {/each}
    </select>
  </div>
  <div class="mb-3">
    <label class="form-label" for="language">{$_('settings.language')}</label>
    <select
      id="language"
      class="form-select"
      bind:value={preferences.language}
      on:change={() => setAppLocale(preferences.language)}
    >
      {#each LOCALE_OPTIONS as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>
  <div class="mb-3">
    <label class="form-label" for="title-mode">{$_("m.871b7ed110")}</label>
    <select id="title-mode" class="form-select" bind:value={preferences.titleMode} on:change={onDeferredChange}>
      <option value="first-line">{$_("m.7358ee0f0a")}</option>
      <option value="separate">{$_("m.4a13beb6d6")}</option>
    </select>
  </div>
  <div class="mb-3">
    <span class="form-label d-block">{$_("m.62c6f9ddb9")}</span>
    <div class="form-check form-check-inline">
      <input class="form-check-input" type="checkbox" id="list-field-title" bind:checked={preferences.listRowFields.title} on:change={onDeferredChange} />
      <label class="form-check-label" for="list-field-title">{$_("m.768e0c1c69")}</label>
    </div>
    <div class="form-check form-check-inline">
      <input class="form-check-input" type="checkbox" id="list-field-summary" bind:checked={preferences.listRowFields.summary} on:change={onDeferredChange} />
      <label class="form-check-label" for="list-field-summary">{$_("m.12b71c3e0f")}</label>
    </div>
    <div class="form-check form-check-inline">
      <input class="form-check-input" type="checkbox" id="list-field-meta" bind:checked={preferences.listRowFields.meta} on:change={onDeferredChange} />
      <label class="form-check-label" for="list-field-meta">{$_("m.e2a9becb94")}</label>
    </div>
    <div class="form-check form-check-inline">
      <input class="form-check-input" type="checkbox" id="list-field-tags" bind:checked={preferences.listRowFields.tags} on:change={onDeferredChange} />
      <label class="form-check-label" for="list-field-tags">{$_("m.848eed0fbd")}</label>
    </div>
  </div>
  <div class="row g-2">
    <div class="col-sm-6">
      <label class="form-label" for="editor-font">{$_("m.b97c4d4cdd")}</label>
      <select
        id="editor-font"
        class="form-select"
        bind:value={preferences.editorFont}
        on:focus={loadLocalFonts}
        on:change={handleEditorFontChange}
      >
        <option value="system">{$_("m.9d8d380806")}</option>
        <option value="sans">{$_("m.ecc39dc539")}</option>
        <option value="serif">{$_("m.a5c78a86fa")}</option>
        <option value="mono">{$_("m.216fcddff2")}</option>
        {#if visibleLocalFontFamilies.length}
          <optgroup label="Local Fonts">
            {#each visibleLocalFontFamilies as family}
              <option value={localFontValue(family)}>{family}</option>
            {/each}
          </optgroup>
        {/if}
        <optgroup label="Coding Fonts">
          {#each CODING_FONT_OPTIONS as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </optgroup>
      </select>
    </div>
    <div class="col-6 col-sm-3">
      <label class="form-label" for="font-size">{$_("m.b7152342a2")}</label>
      <input id="font-size" class="form-control" type="number" min="12" max="32" step="1" bind:value={preferences.editorFontSize} on:change={onDeferredChange} />
    </div>
    <div class="col-6 col-sm-3">
      <label class="form-label" for="line-height">{$_("m.65be5133e7")}</label>
      <input id="line-height" class="form-control" type="number" min="1.2" max="2.5" step="0.1" bind:value={preferences.editorLineHeight} on:change={onDeferredChange} />
    </div>
  </div>
  <div class="row g-2 mt-1">
    <div class="col-6">
      <label class="form-label" for="auto-save-seconds">{$_("m.41380d4108")}</label>
      <div class="input-group">
        <input id="auto-save-seconds" class="form-control" type="number" min="3" max="30" step="1" bind:value={preferences.autoSaveSeconds} on:change={onDeferredChange} />
        <span class="input-group-text">{$_("m.920a25ef68")}</span>
      </div>
    </div>
    <div class="col-6">
      <label class="form-label" for="issue-page-size">{$_("m.31ec42c218")}</label>
      <input id="issue-page-size" class="form-control" type="number" min="10" max="100" step="1" bind:value={preferences.issuePageSize} on:change={onDeferredChange} />
    </div>
  </div>
  <div class="row g-2 mt-1">
    <div class="col-6">
      <label class="form-label" for="editor-max-width">{$_('settings.editorMaxWidth')}</label>
      <div class="input-group">
        <input id="editor-max-width" class="form-control" type="number" min="480" max="1600" step="10" bind:value={preferences.editorMaxWidth} on:change={onDeferredChange} />
        <span class="input-group-text">px</span>
      </div>
    </div>
  </div>
  <div class="mt-3">
    <label class="form-label" for="workspace-cache-minutes">{$_('settings.workspaceCacheDuration')}</label>
    <select
      id="workspace-cache-minutes"
      class="form-select"
      bind:value={preferences.workspaceCacheMinutes}
      on:change={onDeferredChange}
    >
      {#each WORKSPACE_CACHE_OPTIONS as minutes}
        <option value={minutes}>
          {minutes % 60 === 0
            ? `${minutes / 60} ${$_('settings.hours')}`
            : `${minutes} ${$_('settings.minutes')}`}
        </option>
      {/each}
    </select>
    <div class="settings-help-note">※ {$_('settings.workspaceCacheHelp')}</div>
  </div>
  <div class="mt-3">
    <label class="form-label" for="lock-session-minutes">{$_('settings.lockSessionDuration')}</label>
    <select
      id="lock-session-minutes"
      class="form-select"
      bind:value={preferences.lockSessionMinutes}
      on:change={onDeferredChange}
    >
      {#each LOCK_SESSION_OPTIONS as minutes}
        <option value={minutes}>
          {minutes % 60 === 0
            ? `${minutes / 60} ${$_('settings.hours')}`
            : `${minutes} ${$_('settings.minutes')}`}
        </option>
      {/each}
    </select>
    <div class="settings-help-note">※ {$_('settings.lockSessionHelp')}</div>
  </div>
</fieldset>
