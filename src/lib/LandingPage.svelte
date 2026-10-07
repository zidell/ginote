<script>
  import { onMount, tick } from 'svelte';
  import { locale } from 'svelte-i18n';
  import { landingCopy } from './landing-copy.js';
  import { LOCALE_OPTIONS } from './i18n.js';
  import LandingFileLink from './LandingFileLink.svelte';
  import { DESKTOP_DOWNLOADS, loadTuiDownloads } from './release-downloads.js';

  export let onStart = () => {};
  export let onLanguageChange = () => {};
  export let language = 'auto';

  const homebrewInstallCommand = 'brew tap zidell/ginote https://github.com/zidell/ginote\nbrew install --cask ginote';
  const tuiInstallCommand = 'curl -fsSL https://raw.githubusercontent.com/zidell/ginote/main/tui/install.sh | bash';
  const tuiWindowsInstallCommand = 'irm https://raw.githubusercontent.com/zidell/ginote/main/tui/install.ps1 | iex';
  let selectedDownload = '';
  let copyMessage = '';
  let tuiDownloads = [];
  let tuiDownloadsRequested = false;
  $: t = landingCopy[$locale] || landingCopy.en;

  function changeLanguage(event) {
    copyMessage = '';
    onLanguageChange(event.currentTarget.value);
  }

  // Asked only when the TUI guide opens, so a plain landing visit does not call the GitHub API.
  function requestTuiDownloads() {
    if (tuiDownloadsRequested) return;
    tuiDownloadsRequested = true;
    loadTuiDownloads().then((files) => { tuiDownloads = files; }, () => {});
  }

  async function showDownload(platform) {
    selectedDownload = selectedDownload === platform ? '' : platform;
    copyMessage = '';
    if (!selectedDownload) return;
    if (selectedDownload === 'tui') requestTuiDownloads();
    await tick();
    document.getElementById('download-details')?.scrollIntoView?.({ block: 'start' });
  }

  async function copyCommand(command) {
    try {
      await navigator.clipboard.writeText(command);
      copyMessage = t.copied;
    } catch {
      copyMessage = t.copyFailed;
    }
  }

  onMount(async () => {
    if (location.hash !== '#windows-install') return;
    selectedDownload = 'windows';
    await tick();
    document.getElementById('windows-install')?.scrollIntoView?.({ block: 'start' });
  });
</script>

<svelte:head>
  <title>{t.title}</title>
</svelte:head>

<main class="landing">
  <header class="landing-nav">
    <a class="landing-brand" href="./"><img src="./icon.svg" alt="" /> Ginote</a>
    <div class="landing-nav-actions">
      <select class="landing-language" aria-label="Language / 언어" value={language} on:change={changeLanguage}>
        {#each LOCALE_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
      <a href="https://github.com/zidell/ginote" target="_blank" rel="noreferrer">GitHub <i class="bi bi-arrow-up-right" aria-hidden="true"></i></a>
    </div>
  </header>

  <div class="landing-content">
    <section class="landing-hero" aria-labelledby="landing-title">
      <h1 id="landing-title" aria-label="GitHub Issues, as notes">GitHub Issues,<br /><em>as notes</em></h1>
      <p class="landing-lead">{t.lead}</p>
      <div class="landing-preview">
        <img src="./landing-preview.gif" alt={t.previewAlt} />
      </div>
      <div class="landing-actions">
        <button type="button" class="landing-primary" on:click={onStart}>{t.start} <i class="bi bi-arrow-right" aria-hidden="true"></i></button>
        <a class="landing-secondary" href="#downloads">{t.download} <i class="bi bi-arrow-down" aria-hidden="true"></i></a>
      </div>
      <p class="landing-caption">{t.caption}</p>
    </section>

    <section class="landing-details" aria-label={t.featuresLabel}>
      {#each t.features as feature, index}
        <div><strong>{feature.title}</strong><p>{feature.body} {#if index === 0}<a href="https://github.com/github/github-mcp-server" target="_blank" rel="noreferrer">{t.mcpGuide}</a>{/if}</p></div>
      {/each}
    </section>

    <section id="downloads" class="landing-downloads" aria-labelledby="downloads-title">
      <h2 id="downloads-title">{t.download}</h2>
      <div class="landing-download-grid" class:has-selection={Boolean(selectedDownload)}>
        <article class:is-selected={selectedDownload === 'macos'}><h3><i class="bi bi-apple" aria-hidden="true"></i> macOS</h3><p>{t.cards.macos}</p><button type="button" aria-expanded={selectedDownload === 'macos'} on:click={() => showDownload('macos')}>{t.installMethod} {selectedDownload === 'macos' ? t.hide : t.view}</button></article>
        <article class:is-selected={selectedDownload === 'windows'}><h3><i class="bi bi-windows" aria-hidden="true"></i> Windows</h3><p>{t.cards.windows}</p><button type="button" aria-expanded={selectedDownload === 'windows'} on:click={() => showDownload('windows')}>{t.installMethod} {selectedDownload === 'windows' ? t.hide : t.view}</button></article>
        <article class:is-selected={selectedDownload === 'linux'}><h3><i class="bi bi-laptop" aria-hidden="true"></i> Linux</h3><p>{t.cards.linux}</p><button type="button" aria-expanded={selectedDownload === 'linux'} on:click={() => showDownload('linux')}>{t.installMethod} {selectedDownload === 'linux' ? t.hide : t.view}</button></article>
        <article class:is-selected={selectedDownload === 'tui'}><h3><i class="bi bi-terminal" aria-hidden="true"></i> TUI</h3><p>{t.cards.tui}</p><button type="button" aria-expanded={selectedDownload === 'tui'} on:click={() => showDownload('tui')}>{t.installMethod} {selectedDownload === 'tui' ? t.hide : t.view}</button></article>
      </div>
      {#if selectedDownload}
      <div id="download-details" class="landing-install-guide">
      {#if selectedDownload === 'macos'}
        <h3>{t.macTitle}</h3>
        <p>{t.macChoose}</p>
        <div class="landing-install-options">
          <section class="landing-install-option" aria-labelledby="macos-dmg-title">
            <h4 id="macos-dmg-title">{t.dmg}</h4>
            <ol>
              <li>{t.dmgStep1}<br /><LandingFileLink file={DESKTOP_DOWNLOADS.dmg} /></li>
              <li>{t.dmgStep2}</li>
            </ol>
          </section>
          <span class="landing-install-or" aria-hidden="true">OR</span>
          <section class="landing-install-option" aria-labelledby="macos-homebrew-title">
            <h4 id="macos-homebrew-title">{t.homebrew}</h4>
            <p>{t.runCommand}</p>
            <div class="landing-command"><code>{homebrewInstallCommand}</code><button type="button" on:click={() => copyCommand(homebrewInstallCommand)}>{t.copy}</button></div>
            {#if copyMessage}<p class="landing-copy-message" role="status">{copyMessage}</p>{/if}
          </section>
        </div>
      {:else if selectedDownload === 'linux'}
        <h3>{t.linuxTitle}</h3>
        <p>{t.linuxIntro}</p>
        <ul>
          <li><strong>AppImage</strong> · <LandingFileLink file={DESKTOP_DOWNLOADS.appImage} /><br />{t.appImage} <code>chmod +x {DESKTOP_DOWNLOADS.appImage.name} && ./{DESKTOP_DOWNLOADS.appImage.name}</code></li>
          <li><strong>Debian / Ubuntu</strong> · <LandingFileLink file={DESKTOP_DOWNLOADS.deb} /><br /><code>sudo apt install ./{DESKTOP_DOWNLOADS.deb.name}</code></li>
          <li><strong>Fedora / RHEL</strong> · <LandingFileLink file={DESKTOP_DOWNLOADS.rpm} /><br /><code>sudo dnf install ./{DESKTOP_DOWNLOADS.rpm.name}</code></li>
        </ul>
      {:else if selectedDownload === 'tui'}
        <h3>{t.tuiTitle}</h3>
        <h4>macOS / Linux</h4>
        <p>{t.tuiReq}</p>
        <div class="landing-command"><code>{tuiInstallCommand}</code><button type="button" on:click={() => copyCommand(tuiInstallCommand)}>{t.copy}</button></div>
        <p>{t.tuiAfter}</p>
        <h4>Windows / PowerShell</h4>
        <p>{t.tuiWindowsReq}</p>
        <div class="landing-command"><code>{tuiWindowsInstallCommand}</code><button type="button" on:click={() => copyCommand(tuiWindowsInstallCommand)}>{t.copy}</button></div>
        <p>{t.tuiWindowsAfter} <a href="https://github.com/zidell/ginote/blob/main/tui/install.ps1" target="_blank" rel="noreferrer">{t.installScript}</a></p>
        {#if copyMessage}<p class="landing-copy-message" role="status">{copyMessage}</p>{/if}
        <p>{t.tuiPrebuilt}</p>
        {#if tuiDownloads.length}
          <ul class="landing-file-list">
            {#each tuiDownloads as file}<li><strong>{file.label}</strong> · <LandingFileLink {file} /></li>{/each}
          </ul>
        {:else}
          <p><LandingFileLink fallbackLabel={t.tuiReleaseLabel} fallbackUrl="https://github.com/zidell/ginote/releases" /></p>
        {/if}
        <p><a href="https://github.com/zidell/ginote/blob/main/tui/install.sh" target="_blank" rel="noreferrer">{t.installScript} (macOS / Linux)</a> · <a href="https://github.com/zidell/ginote/blob/main/docs/TUI.md" target="_blank" rel="noreferrer">{t.tuiDocs}</a></p>
      {:else if selectedDownload === 'windows'}
      <div id="windows-install" class="landing-windows-guide">
        <div>
          <h3>{t.windowsTitle}</h3>
          <p>{t.windowsIntro}</p>
          <ol>
            <li>{t.windowsStep1}<br /><LandingFileLink file={DESKTOP_DOWNLOADS.windows} /></li>
            <li>{t.windowsStep2}</li>
            <li>{t.windowsStep3}</li>
          </ol>
          <p class="landing-guide-note">{t.windowsNote}</p>
        </div>
        <div class="landing-warning-example" aria-label={t.exampleLabel}>
          <span class="landing-example-label">{t.exampleLabel}</span>
          <div class="landing-warning-panel" aria-hidden="true">
            <span class="landing-warning-icon">⊘</span>
            <strong>{t.protect}</strong>
            <p>{t.protectMsg}</p>
            <span class="landing-warning-link">{t.moreInfo}</span>
            <div class="landing-warning-publisher">{t.app}: {DESKTOP_DOWNLOADS.windows.name}<br />{t.publisher}</div>
            <span class="landing-warning-run">{t.run}</span>
          </div>
        </div>
      </div>
      {/if}
      </div>
      {/if}
      <p class="landing-pwa">{t.pwa}</p>
    </section>
  </div>
  <footer class="landing-footer">Ginote · <a href="https://github.com/zidell/ginote">{t.source}</a> · GPLv3</footer>
</main>
