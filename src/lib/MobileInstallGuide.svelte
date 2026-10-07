<script>
  import { _ } from 'svelte-i18n';
  import { appInstalled, installPrompt, promptInstall } from './pwa-install.js';

  export let platform = '';
  export let variant = 'card';
  export let onDismiss = null;

  $: canPrompt = platform === 'android' && Boolean($installPrompt);
  $: steps = platform === 'ios' ? $_('help.appPwaIOS') : $_('help.appPwaAndroid');

  async function install() {
    if (await promptInstall($installPrompt)) appInstalled.set(true);
  }
</script>

{#if variant === 'banner'}
  <div class="pwa-install-banner" role="region" aria-label={$_('pwaInstall.title')}>
    <img src="./icon.svg" alt="" />
    <div class="pwa-install-banner-text">
      <strong>{$_('pwaInstall.title')}</strong>
      <span>{$appInstalled ? $_('pwaInstall.installed') : canPrompt ? $_('pwaInstall.intro') : steps}</span>
    </div>
    {#if canPrompt && !$appInstalled}
      <button type="button" class="btn btn-sm btn-primary" on:click={install}>{$_('pwaInstall.install')}</button>
    {/if}
    <button type="button" class="btn btn-sm pwa-install-dismiss" aria-label={$_('pwaInstall.dismiss')} on:click={() => onDismiss?.()}>
      <i class="bi bi-x-lg" aria-hidden="true"></i>
    </button>
  </div>
{:else}
  <article class="landing-mobile-install">
    <h3><i class="bi bi-phone" aria-hidden="true"></i> {$_('pwaInstall.title')}</h3>
    <p>{$_('pwaInstall.intro')}</p>
    {#if $appInstalled}
      <p role="status">{$_('pwaInstall.installed')}</p>
    {:else if canPrompt}
      <button type="button" class="landing-primary" on:click={install}>{$_('pwaInstall.install')} <i class="bi bi-download" aria-hidden="true"></i></button>
    {:else}
      <p class="landing-mobile-install-steps">{steps}</p>
    {/if}
  </article>
{/if}
