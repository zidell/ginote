<script>
  import { _ } from 'svelte-i18n';
  import { externalLinkTarget } from './external-links.js';

  export let repo = '';
  export let tokenInputValue = '';
  export let rememberToken = true;
  export let busy = false;
  export let error = '';
  export let patCreationUrl = 'https://github.com/settings/personal-access-tokens/new';
  export let onConnect = () => {};

  const externalTarget = externalLinkTarget();
  const lastStep = 4;
  let step = 1;

  $: normalizedRepository = repo
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  $: repositoryIsValid = /^[^/\s]+\/[^/\s]+$/.test(normalizedRepository);

  function next() {
    if (step === 3 && !repositoryIsValid) return;
    step = Math.min(lastStep, step + 1);
  }

  function previous() {
    if (busy) return;
    step = Math.max(1, step - 1);
  }

  function submit() {
    if (step < lastStep) {
      next();
      return;
    }
    onConnect();
  }
</script>

<a class="setup-source-link small text-secondary" href="https://github.com/zidell/ginote" target={externalTarget} rel="noreferrer">
  <i class="bi bi-github me-1" aria-hidden="true"></i>{$_('meta.sourceCode')}
</a>

<main class="setup-shell setup-wizard-shell px-3 py-4 py-md-5">
  <section class="setup-card setup-wizard card border-0 shadow-sm mx-auto overflow-hidden">
    <div class="bg-white p-4 p-md-5">
      <header class="setup-wizard-header">
        <img class="brand-mark" src="./icon.svg" alt="" />
        <div>
          <h1 class="h4 fw-bold mb-1">{$_('setup.wizardTitle')}</h1>
          <p class="text-secondary mb-0">{$_('setup.stepCount', { values: { step, total: lastStep } })}</p>
        </div>
      </header>

      <ol class="setup-progress" aria-label={$_('setup.progressLabel')}>
        {#each Array(lastStep) as _, index}
          <li class:active={index + 1 === step} class:complete={index + 1 < step}>
            <span>{index + 1 < step ? '✓' : index + 1}</span>
          </li>
        {/each}
      </ol>

      {#if error && step === lastStep}
        <div class="alert alert-danger" role="alert">{error}</div>
      {/if}

      <form on:submit|preventDefault={submit}>
        <div class="setup-step" aria-live="polite">
          {#if step === 1}
            <div class="setup-step-icon"><i class="bi bi-journal-text" aria-hidden="true"></i></div>
            <h2 class="h5 fw-bold">{$_('setup.introTitle')}</h2>
            <p class="text-secondary">{$_('setup.introDescription')}</p>
            <ul class="setup-feature-list">
              <li><i class="bi bi-cloud-check" aria-hidden="true"></i><span>{$_('setup.introFeatureStorage')}</span></li>
              <li><i class="bi bi-tags" aria-hidden="true"></i><span>{$_('setup.introFeatureTags')}</span></li>
              <li><i class="bi bi-shield-lock" aria-hidden="true"></i><span>{$_('setup.introFeaturePrivacy')}</span></li>
            </ul>
          {:else if step === 2}
            <div class="setup-step-icon"><i class="bi bi-github" aria-hidden="true"></i></div>
            <h2 class="h5 fw-bold">{$_('setup.accountTitle')}</h2>
            <p class="text-secondary">{$_('setup.accountDescription')}</p>
            <a class="btn btn-outline-secondary w-100" href="https://github.com/signup" target={externalTarget} rel="noreferrer">
              <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
              {$_('setup.createAccount')}
            </a>
          {:else if step === 3}
            <div class="setup-step-icon"><i class="bi bi-lock-fill" aria-hidden="true"></i></div>
            <h2 class="h5 fw-bold">{$_('setup.repositoryTitle')}</h2>
            <p class="text-secondary">{$_('setup.repositoryDescription')}</p>
            <a class="btn btn-outline-secondary w-100 mb-4" href="https://github.com/new?visibility=private" target={externalTarget} rel="noreferrer">
              <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
              {$_('setup.createRepository')}
            </a>
            <label for="setup-repo" class="form-label fw-semibold">{$_('setup.repositoryAddress')}</label>
            <input
              id="setup-repo"
              class="form-control form-control-lg"
              class:is-invalid={repo.trim() && !repositoryIsValid}
              bind:value={repo}
              placeholder="https://github.com/owner/repository"
              autocomplete="off"
              disabled={busy}
              required
            />
            <div class="form-text">{$_('setup.repositoryAddressHelp')}</div>
          {:else}
            <div class="setup-step-icon"><i class="bi bi-key" aria-hidden="true"></i></div>
            <h2 class="h5 fw-bold">{$_('setup.patTitle')}</h2>
            <p class="text-secondary">{$_('setup.patDescription')}</p>
            <a class="btn btn-outline-secondary w-100 mb-4" href={patCreationUrl} target={externalTarget} rel="noreferrer">
              <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
              {$_('setup.createPat')}
            </a>
            <label for="setup-token" class="form-label fw-semibold">Fine-grained PAT</label>
            <input
              id="setup-token"
              type="password"
              class="form-control form-control-lg font-monospace"
              bind:value={tokenInputValue}
              placeholder="github_pat_..."
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              inputmode="text"
              spellcheck="false"
              disabled={busy}
              required
            />
            <div class="form-text">{$_('setup.patHelp')}</div>
            <div class="form-check mt-3">
              <input id="setup-remember" class="form-check-input" type="checkbox" bind:checked={rememberToken} disabled={busy} />
              <label class="form-check-label" for="setup-remember">{$_('setup.rememberPat')}</label>
            </div>
          {/if}
        </div>

        <div class="setup-wizard-actions">
          {#if step > 1}
            <button type="button" class="btn btn-link text-secondary" on:click={previous} disabled={busy}>
              <i class="bi bi-chevron-left" aria-hidden="true"></i> {$_('setup.previous')}
            </button>
          {:else}
            <span></span>
          {/if}
          <button class="btn btn-primary px-4" disabled={busy || (step === 3 && !repositoryIsValid)}>
            {#if busy}
              <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
              {$_('setup.connecting')}
            {:else if step === 1}
              {$_('setup.start')} <i class="bi bi-chevron-right" aria-hidden="true"></i>
            {:else if step === 2}
              {$_('setup.haveAccount')} <i class="bi bi-chevron-right" aria-hidden="true"></i>
            {:else if step === 3}
              {$_('setup.repositoryDone')} <i class="bi bi-chevron-right" aria-hidden="true"></i>
            {:else}
              <i class="bi bi-check-lg" aria-hidden="true"></i> {$_('setup.finish')}
            {/if}
          </button>
        </div>
      </form>

    </div>
  </section>
</main>
