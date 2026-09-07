<script>
  import { _ } from 'svelte-i18n';

  export let mcpRepository = '';
  export let mcpUsagePrompt = '';
  export let onCopy = () => {};
  export let newContextTarget = null;
</script>

<p class="small help-text">
  {$_("m.e83c891d49")}
</p>

<div class="mcp-repository mb-3">
  <span class="small text-secondary">{$_("m.4b3f74b117")}</span>
  <div class="input-group input-group-sm mt-1">
    <input class="form-control font-monospace" value={mcpRepository} readonly aria-label={$_("m.d53b2b9304")} />
    <button
      type="button"
      class="btn btn-outline-secondary"
      on:click={() => onCopy(mcpRepository, $_("m.f200511c62"))}
      disabled={!mcpRepository}
    ><i class="bi bi-copy" aria-hidden="true"></i> {$_("m.af74f7c536")}</button>
  </div>
</div>

<ol class="pat-steps mb-3">
  <li>
    <strong>{$_("m.3bfe3b4ca9")}</strong>
    <span>{$_("m.a361d3f1f3")}</span>
  </li>
  <li>
    <strong>{$_("m.d011f1e8c4")}</strong>
    <span>{$_("m.b7aa3105c9")}</span>
  </li>
  <li>
    <strong>{$_("m.7eb30a2712")}</strong>
    <span>{$_("m.bbd3fa2b66")}</span>
  </li>
</ol>

<p class="small help-text">
  {$_("m.689b609f4f")}
  {' '}<code>.issue-note-assets/issues/42/</code>.{' '}
  {$_("m.19c4d90df7")}
</p>

<label class="form-label small" for="mcp-usage-prompt">{$_("m.2838abde9d")}</label>
<textarea id="mcp-usage-prompt" class="form-control form-control-sm mcp-prompt mb-2" readonly value={mcpUsagePrompt}></textarea>
<button
  type="button"
  class="btn btn-sm btn-outline-primary w-100 mb-2"
  on:click={() => onCopy(mcpUsagePrompt, $_("m.bacaacbf86"))}
><i class="bi bi-copy" aria-hidden="true"></i> {$_("m.81979baa04")}</button>
<a
  class="btn btn-sm btn-outline-secondary w-100"
  href="https://github.com/github/github-mcp-server"
  target={newContextTarget}
  rel="noreferrer"
><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> {$_("m.6b45c11893")}</a>
