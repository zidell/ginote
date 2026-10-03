<script>
  // 앱 자체 업데이트 안내(src/lib/release-update.js). macOS의 Sparkle처럼 "이 버전 건너뛰기 /
  // 나중에 / 지금 설치"를 고르고, 설치가 끝나면 다시 시작할지 묻는다.
  import { _ } from 'svelte-i18n';
  import SheetView from './SheetView.svelte';
  import { installReleaseUpdate, restartApp, saveReleaseUpdatePreferences } from './release-update.js';

  export let update;
  export let currentVersion = '';
  export let onClose = () => {};

  let phase = 'offer';
  let progress = null;
  let failure = '';

  function later() {
    if (phase === 'installing') return;
    onClose();
  }

  function skip() {
    saveReleaseUpdatePreferences({ skippedVersion: update.version });
    onClose();
  }

  async function install() {
    phase = 'installing';
    progress = null;
    failure = '';
    try {
      await installReleaseUpdate(update, (value) => { progress = value; });
      phase = 'installed';
    } catch (reason) {
      failure = String(reason?.message || reason);
      phase = 'failed';
    }
  }

  function restart() {
    void restartApp();
  }
</script>

<SheetView title={$_('dynamic.releaseUpdateTitle')} closeLabel={$_('dynamic.releaseUpdateLater')} onClose={later} layer={3}>
  <div class="release-update">
    {#if phase === 'installed'}
      <p>{$_('dynamic.releaseUpdateInstalled')}</p>
      <div class="release-update-actions">
        <button type="button" class="btn btn-outline-secondary" on:click={onClose}>{$_('dynamic.releaseUpdateRestartLater')}</button>
        <button type="button" class="btn btn-primary" on:click={restart}>{$_('dynamic.releaseUpdateRestart')}</button>
      </div>
    {:else}
      <p>{$_('dynamic.releaseUpdateAvailable', { values: { version: update.version, current: currentVersion || update.currentVersion } })}</p>
      {#if update.body}
        <pre class="release-update-notes">{update.body}</pre>
      {/if}
      {#if phase === 'installing'}
        <p class="small text-secondary mb-2" role="status">{$_('dynamic.releaseUpdateInstalling')}</p>
        <div class="progress" role="progressbar" aria-label={$_('dynamic.releaseUpdateInstalling')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress == null ? undefined : Math.round(progress * 100)}>
          <div class="progress-bar" class:progress-bar-striped={progress == null} class:progress-bar-animated={progress == null} style:width={progress == null ? '100%' : `${Math.round(progress * 100)}%`}></div>
        </div>
      {:else}
        {#if phase === 'failed'}
          <div class="alert alert-danger" role="alert">{$_('dynamic.releaseUpdateFailed', { values: { error: failure } })}</div>
        {/if}
        <div class="release-update-actions">
          <button type="button" class="btn btn-link me-auto px-0" on:click={skip}>{$_('dynamic.releaseUpdateSkip')}</button>
          <button type="button" class="btn btn-outline-secondary" on:click={later}>{$_('dynamic.releaseUpdateLater')}</button>
          <button type="button" class="btn btn-primary" on:click={install}>{$_('dynamic.releaseUpdateInstall')}</button>
        </div>
      {/if}
    {/if}
  </div>
</SheetView>
