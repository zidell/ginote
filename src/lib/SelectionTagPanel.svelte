<script>
  import { _, locale as activeLocale } from 'svelte-i18n';
  import { tagColorForName } from './colors.js';
  import { countIssueLabels, tagOptions } from './issue-labels.js';
  import { normalizeTagName } from './notes.js';

  // 여러 노트를 골랐을 때 태그를 한꺼번에 붙이거나 떼는 패널이다.
  export let labels = [];
  export let selectedIssues = [];
  export let busy = false;
  export let onApply = () => {};

  let search = '';

  $: counts = countIssueLabels(selectedIssues);
  $: options = tagOptions(labels, counts, search, $activeLocale);
  $: newTagName = normalizeTagName(search);
  $: canCreate = Boolean(newTagName)
    && !options.some((option) => option.name.toLocaleLowerCase() === newTagName.toLocaleLowerCase());

  function toggle(name) {
    const applied = counts.get(name.toLocaleLowerCase()) || 0;
    // 선택한 노트 전부에 붙어 있을 때만 떼고, 일부만 붙어 있으면 나머지에 마저 붙인다.
    onApply(name, applied > 0 && applied === selectedIssues.length ? 'remove' : 'add');
  }

  function autofocus(node) {
    requestAnimationFrame(() => node.focus());
  }
</script>

<div class="sidebar-selection-tags" class:is-busy={busy}>
  <div class="selection-tag-search">
    <input
      bind:value={search}
      placeholder={$_("m.eb7b580e41")}
      aria-label={$_("m.eb7b580e41")}
      maxlength="51"
      use:autofocus
    />
    {#if busy}
      <span class="spinner-border spinner-border-sm region-spinner" aria-hidden="true"></span>
    {/if}
  </div>
  <div class="selection-tag-list" aria-label={$_("m.9e704d11d1")}>
    {#each options as option (option.name)}
      {@const appliedToAll = option.count > 0 && option.count === selectedIssues.length}
      <button
        type="button"
        disabled={busy}
        on:click={() => toggle(option.name)}
      >
        <span class="label-dot" style={`--label-color:#${tagColorForName(option.name)}`}></span>
        <span class="selection-tag-name">#{option.name}</span>
        {#if option.count}
          <span class="selection-tag-count">{option.count}/{selectedIssues.length}</span>
        {/if}
        <i class={`bi ${appliedToAll ? 'bi-dash-lg' : 'bi-plus-lg'}`} aria-hidden="true"></i>
      </button>
    {/each}
    {#if canCreate}
      <button
        type="button"
        class="create-tag"
        disabled={busy}
        on:click={() => onApply(newTagName, 'add')}
      >
        <span class="label-dot" style={`--label-color:#${tagColorForName(newTagName)}`}></span>
        {$_('dynamic.createTag', { values: { name: newTagName } })}
      </button>
    {:else if !options.length}
      <span class="tag-dropdown-empty">{$_("m.2240ffb750")}</span>
    {/if}
  </div>
</div>
