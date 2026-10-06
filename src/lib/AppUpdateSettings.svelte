<script>
  // 설정 화면의 앱 업데이트 항목. 앱이 스스로 업데이트하는 데스크톱 플랫폼에서만 보인다.
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import {
    currentAppVersion,
    findReleaseUpdate,
    loadReleaseUpdatePreferences,
    releaseUpdateSupported,
    saveReleaseUpdatePreferences
  } from './release-update.js';

  export let onUpdateFound = () => {};

  let supported = false;
  let version = '';
  let checkAutomatically = loadReleaseUpdatePreferences().checkAutomatically;
  let checking = false;
  let status = '';

  onMount(async () => {
    supported = await releaseUpdateSupported();
    if (supported) version = await currentAppVersion().catch(() => '');
  });

  function toggleAutomatic() {
    saveReleaseUpdatePreferences({ checkAutomatically });
  }

  async function checkNow() {
    checking = true;
    status = '';
    try {
      const update = await findReleaseUpdate({ manual: true });
      if (update) onUpdateFound(update);
      else status = $_('dynamic.releaseUpdateUpToDate', { values: { version } });
    } catch (reason) {
      status = $_('dynamic.releaseUpdateCheckFailed', { values: { error: String(reason?.message || reason) } });
    } finally {
      checking = false;
    }
  }
</script>

{#if supported}
  <div class="workspace-section mb-4">
    <h3 class="workspace-section-title">{$_('dynamic.releaseUpdateSettingsTitle')}</h3>
    <p class="form-text mt-0">{$_('dynamic.releaseUpdateCurrent', { values: { version } })}</p>
    <div class="form-check mb-2">
      <input id="release-update-auto" class="form-check-input" type="checkbox" bind:checked={checkAutomatically} on:change={toggleAutomatic} />
      <label class="form-check-label" for="release-update-auto">{$_('dynamic.releaseUpdateAutoCheck')}</label>
    </div>
    <button type="button" class="btn btn-sm btn-outline-secondary" on:click={checkNow} disabled={checking}>
      {checking ? $_('dynamic.releaseUpdateChecking') : $_('dynamic.releaseUpdateCheckNow')}
    </button>
    {#if status}<p class="small text-secondary mt-2 mb-0" role="status">{status}</p>{/if}
  </div>
{/if}
