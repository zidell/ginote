<script>
  import { afterUpdate, createEventDispatcher, onDestroy } from 'svelte';
  import { renderMarkdown } from './markdown-viewer.js';

  export let source = '';
  export let emptyLabel = '';
  export let className = '';
  export let imageSources = {};

  const dispatch = createEventDispatcher();
  let root;
  let trackedImages = [];
  let resizeFrame = 0;
  let settleFrame = 0;

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
    scheduleContentResize();
  });

  onDestroy(() => {
    removeImageListeners();
    cancelContentResize();
  });

  function pendingImageCount() {
    return trackedImages.filter((image) => !image.complete).length;
  }

  function refreshImageListeners() {
    removeImageListeners();
    if (root) {
      root.querySelectorAll('img').forEach((image) => {
        const originalSource = image.dataset.markdownSource || image.getAttribute('src') || '';
        image.dataset.markdownSource = originalSource;
        image.setAttribute('src', imageSources[originalSource] || originalSource);
        trackedImages.push(image);
      });
    }
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
    scheduleContentResize();
  }

  function cancelContentResize() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    if (settleFrame) cancelAnimationFrame(settleFrame);
    resizeFrame = 0;
    settleFrame = 0;
  }

  function scheduleContentResize() {
    cancelContentResize();
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      settleFrame = requestAnimationFrame(() => {
        settleFrame = 0;
        dispatch('contentresize', { pendingImages: pendingImageCount() });
      });
    });
  }
</script>

<div class={`markdown-preview${className ? ` ${className}` : ''}`} bind:this={root} tabindex="-1" role="document">
  {#if rendered}
    {@html rendered}
  {:else if emptyLabel}
    <p class="markdown-preview-empty">{emptyLabel}</p>
  {/if}
</div>
