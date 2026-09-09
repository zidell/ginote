<script>
  import { afterUpdate, createEventDispatcher, onDestroy } from 'svelte';
  import { renderMarkdown } from './markdown-viewer.js';

  export let source = '';
  export let emptyLabel = '';
  export let className = '';

  const dispatch = createEventDispatcher();
  let root;
  let trackedImages = [];

  $: rendered = renderMarkdown(source);

  export function focus() {
    try {
      root?.focus({ preventScroll: true });
    } catch {
      root?.focus();
    }
  }

  afterUpdate(() => {
    refreshImageListeners();
    dispatch('contentresize', { pendingImages: pendingImageCount() });
  });

  onDestroy(() => removeImageListeners());

  function pendingImageCount() {
    return trackedImages.filter((image) => !image.complete).length;
  }

  function refreshImageListeners() {
    removeImageListeners();
    if (root) trackedImages.push(...root.querySelectorAll('img'));
    trackedImages.forEach((image) => {
      image.addEventListener('load', handleImageSettled);
      image.addEventListener('error', handleImageSettled);
    });
  }

  function removeImageListeners() {
    trackedImages.forEach((image) => {
      image.removeEventListener('load', handleImageSettled);
      image.removeEventListener('error', handleImageSettled);
    });
    trackedImages.length = 0;
  }

  function handleImageSettled() {
    dispatch('contentresize', { pendingImages: pendingImageCount() });
  }
</script>

<div class={`markdown-preview${className ? ` ${className}` : ''}`} bind:this={root} tabindex="-1" role="document">
  {#if rendered}
    {@html rendered}
  {:else if emptyLabel}
    <p class="markdown-preview-empty">{emptyLabel}</p>
  {/if}
</div>
