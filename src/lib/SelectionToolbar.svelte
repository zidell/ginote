<script>
  import { _ } from 'svelte-i18n';

  // 여러 노트를 골랐을 때 사이드바 머리에 나타나는 작업 도구다.
  export let active = false;
  export let state = 'open';
  export let selectedCount = 0;
  export let tagPanelOpen = false;
  // 병합·태그 작업이나 휴지통 유예가 진행 중이면 다른 일괄 작업을 막는다.
  export let busy = false;
  export let onToggleTags = () => {};
  export let onMerge = () => {};
  export let onMove = () => {};
  export let onCancel = () => {};

  $: tabindex = active ? 0 : -1;
  $: mergeTitle = state !== 'open'
    ? $_('dynamic.mergeOpenOnly')
    : selectedCount < 2 ? $_('dynamic.mergeSelectMore') : undefined;
</script>

<div class="sidebar-selection-toolbar" class:active aria-hidden={!active}>
  <button
    type="button"
    class="btn btn-sm btn-outline-secondary"
    class:active={tagPanelOpen}
    aria-expanded={tagPanelOpen}
    on:click={() => onToggleTags()}
    {tabindex}
  >
    <i class="bi bi-tags" aria-hidden="true"></i> {$_("m.848eed0fbd")}
  </button>
  <button
    type="button"
    class="btn btn-sm btn-outline-secondary"
    disabled={busy || state !== 'open' || selectedCount < 2}
    on:click={() => onMerge()}
    {tabindex}
    title={mergeTitle}
  >
    <i class="bi bi-intersect" aria-hidden="true"></i> {$_('dynamic.merge')}
  </button>
  <button
    type="button"
    class="btn btn-sm btn-outline-danger"
    disabled={busy}
    on:click={() => onMove()}
    {tabindex}
  >
    <i class={`bi ${state === 'open' ? 'bi-trash3' : 'bi-arrow-counterclockwise'}`} aria-hidden="true"></i>
    {state === 'open' ? $_("m.f6fdbe48dc") : $_("m.3cbe6d6b9a")}
  </button>
  <button type="button" class="btn btn-sm btn-outline-secondary" on:click={() => onCancel()} {tabindex}>
    {$_("m.bbfa773e5a")}
  </button>
</div>
