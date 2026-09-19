<script>
  import { _ } from 'svelte-i18n';
  import McpGuide from './McpGuide.svelte';
  import { externalLinkTarget } from './external-links.js';

  export let topic;
  export let mcpRepository = '';
  export let mcpUsagePrompt = '';
  export let onCopy = () => {};
  export let onClose = () => {};

  const newContextTarget = externalLinkTarget();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main
  class="setup-shell help-overlay container py-4 py-md-5"
  on:click={(event) => { if (event.target === event.currentTarget) onClose(); }}
>
  <section class="setup-card card border-0 shadow-sm mx-auto overflow-hidden">
    <div class="row g-0">
      <div class="col-12 bg-white p-4 p-md-5">
        <div class="d-flex align-items-start justify-content-between gap-3 mb-4">
          <h2 class="h4 fw-bold mb-0">
            {#if topic === 'security'}
              {$_('help.securityTitle')}
            {:else if topic === 'mcp'}
              {$_('m.5fe5834eaa')}
            {:else if topic === 'keyboard'}
              {$_('help.keyboardTitle')}
            {:else}
              {$_('help.appTitle')}
            {/if}
          </h2>
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary flex-shrink-0"
            aria-label={$_("m.bbfa773e5a")}
            title={$_("m.bbfa773e5a")}
            on:click={onClose}
          ><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </div>
        {#if topic === 'security'}
          <p class="small help-text">{$_('help.securityIntro')}</p>
          <div class="help-diagram">
            <div>{$_('help.securityDiagramFlow')}</div>
            <div class="help-diagram-note">{$_('help.securityDiagramNote')}</div>
          </div>
          <ul class="help-points small help-text">
            <li>{$_('help.securityPoint1')}</li>
            <li>{$_('help.securityPoint2')}</li>
            <li>{$_('help.securityPoint3')}</li>
            <li>{$_('help.securityPoint4')}</li>
            <li>{$_('help.securityPoint5')}</li>
          </ul>
          <p class="small help-text">{$_('help.securityOutro')}</p>
          <a
            class="btn btn-sm btn-link"
            href="https://github.com/zidell/ginote#readme"
            target={newContextTarget}
            rel="noreferrer"
          ><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> {$_('help.securityLinkLabel')}</a>
        {:else if topic === 'mcp'}
          <p class="small help-text">{$_('help.mcpIntro')}</p>
          <McpGuide {mcpRepository} {mcpUsagePrompt} onCopy={onCopy} {newContextTarget} />
        {:else if topic === 'keyboard'}
          <p class="small help-text">{$_('help.keyboardIntro')}</p>
          <dl class="keyboard-shortcuts small help-text">
            <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>{$_('help.keyboardMove')}</dd></div>
            <div><dt><kbd>Enter</kbd></dt><dd>{$_('help.keyboardOpen')}</dd></div>
            <div><dt><kbd>N</kbd></dt><dd>{$_('help.keyboardNew')}</dd></div>
            <div><dt><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>R</kbd></dt><dd>{$_('help.keyboardRefresh')}</dd></div>
            <div><dt><kbd>`</kbd></dt><dd>{$_('help.keyboardWorkspaceMenu')}</dd></div>
            <div><dt><kbd>1</kbd>~<kbd>9</kbd></dt><dd>{$_('help.keyboardWorkspace')}</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>{$_('help.keyboardEscape')}</dd></div>
            <div><dt><kbd>Space</kbd></dt><dd>{$_('help.keyboardSelect')}</dd></div>
            <div><dt><kbd>Shift</kbd> + <kbd>↑</kbd> <kbd>↓</kbd></dt><dd>{$_('help.keyboardRangeSelect')}</dd></div>
            <div><dt><kbd>Delete</kbd> / <kbd>Backspace</kbd></dt><dd>{$_('help.keyboardTrash')}</dd></div>
            <div><dt><kbd>R</kbd> <kbd>S</kbd> <kbd>T</kbd> <kbd>A</kbd> <kbd>E</kbd> <kbd>X</kbd> <kbd>P</kbd> <kbd>L</kbd> <kbd>Delete</kbd> <kbd>G</kbd> <kbd>M</kbd></dt><dd>{$_('help.keyboardNoteActions')}</dd></div>
          </dl>
          <p class="small help-text mb-0">{$_('help.keyboardNote')}</p>
        {:else}
          <p class="small help-text">{$_('help.appIntro')}</p>
          <h3 class="help-section-title">{$_('help.appPwaSectionTitle')}</h3>
          <ul class="help-points small help-text">
            <li>{$_('help.appPwaChromeDesktop')}</li>
            <li>{$_('help.appPwaAndroid')}</li>
            <li>{$_('help.appPwaIOS')}</li>
            <li>{$_('help.appPwaMacSafari')}</li>
          </ul>
          <p class="small help-text">{$_('help.appPwaNote')}</p>
          <h3 class="help-section-title">{$_('help.appDesktopSectionTitle')}</h3>
          <p class="small help-text">{$_('help.appDesktopIntro')}</p>
          <p class="small help-text mb-1">{$_('help.appDesktopHomebrew')}</p>
          <pre class="help-code">brew tap zidell/ginote https://github.com/zidell/ginote
brew install --cask ginote</pre>
          <a
            class="btn btn-sm btn-link"
            href="https://github.com/zidell/ginote/releases"
            target={newContextTarget}
            rel="noreferrer"
          ><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> {$_('help.appDesktopLinkLabel')}</a>
        {/if}
      </div>
    </div>
  </section>
</main>
