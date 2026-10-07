<script>
  import { formatSize, LATEST_RELEASE_URL } from './release-downloads.js';

  // file comes from release-downloads.js; until it loads (or if GitHub is unreachable) the release page is linked.
  export let file = null;
  export let fallbackLabel = '';
  export let fallbackUrl = LATEST_RELEASE_URL;
</script>

{#if file}
  <a class="landing-file" href={file.url} download={file.name}><i class="bi bi-download" aria-hidden="true"></i> {file.name}{#if file.size}<span>{formatSize(file.size)}</span>{/if}</a>
{:else}
  <a href={fallbackUrl} target="_blank" rel="noreferrer">{fallbackLabel}</a>
{/if}
