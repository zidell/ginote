<script>
  import { onDestroy, onMount } from 'svelte';
  import { tagColorForName } from './colors.js';
  import { normalizeTagName } from './notes.js';
  import { isPinLabel } from './pin-label.js';
  import { _ } from 'svelte-i18n';

  export let availableLabels = [];
  export let selectedLabels = [];
  export let disabled = false;
  export let toolbar = false;
  export let iconOnly = false;
  export let shortcut = '';
  export let shortcutEnabled = true;
  export let onSelect = () => {};
  export let open = false;

  let search = '';
  let picker;
  let searchInput;

  $: visibleAvailableLabels = availableLabels.filter((label) => !isPinLabel(label));
  $: visibleSelectedLabels = selectedLabels.filter((name) => !isPinLabel(name));
  $: pickerLabels = [
    ...visibleAvailableLabels,
    ...visibleSelectedLabels
      .filter((name) => !visibleAvailableLabels.some((label) => label.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
      .map((name) => ({ name }))
  ];
  $: filteredLabels = pickerLabels
    .filter((label) => label.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .slice(0, 12);
  $: newTagName = normalizeTagName(search);
  $: canCreate = Boolean(newTagName)
    && !isPinLabel(newTagName)
    && !hasSelected(newTagName)
    && !visibleAvailableLabels.some((label) => label.name.toLocaleLowerCase() === newTagName.toLocaleLowerCase());

  onMount(() => document.addEventListener('pointerdown', handleOutside));
  onDestroy(() => document.removeEventListener('pointerdown', handleOutside));

  function hasSelected(name) {
    return visibleSelectedLabels.some((label) => label.toLocaleLowerCase() === name.toLocaleLowerCase());
  }

  function toggle() {
    if (disabled) return;
    open = !open;
    search = '';
    if (open) requestAnimationFrame(() => searchInput?.focus());
  }

  export function openPicker() {
    if (disabled) return;
    open = true;
    search = '';
    requestAnimationFrame(() => searchInput?.focus());
  }

  export function close() {
    if (picker?.contains(document.activeElement)) document.activeElement?.blur?.();
    open = false;
    search = '';
    searchInput?.blur();
  }

  function select(name) {
    onSelect(name);
    search = '';
    requestAnimationFrame(() => searchInput?.focus());
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const exact = filteredLabels.find(
      (label) => label.name.toLocaleLowerCase() === search.trim().toLocaleLowerCase()
    );
    if (exact) select(exact.name);
    else if (canCreate) select(newTagName);
    else if (filteredLabels[0]) select(filteredLabels[0].name);
  }

  function handlePickerEscape(event) {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function captureEscape(node) {
    node.addEventListener('keydown', handlePickerEscape, true);
    return {
      destroy() {
        node.removeEventListener('keydown', handlePickerEscape, true);
      }
    };
  }

  function handleExternalEscape() {
    close();
  }

  function handleOutside(event) {
    if (open && !picker?.contains(event.target)) {
      open = false;
      search = '';
    }
  }
</script>

<div
  class="tag-picker"
  class:toolbar
  bind:this={picker}
  use:captureEscape
  on:escape-close={handleExternalEscape}
>
  <button
    type="button"
    class:btn={toolbar}
    class:btn-sm={toolbar && !iconOnly}
    class:btn-outline-secondary={toolbar}
    class:tag-picker-toggle={!toolbar}
    class:tag-picker-icon-only={iconOnly}
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-keyshortcuts={toolbar ? 'T' : undefined}
    aria-label={iconOnly ? `${$_("m.848eed0fbd")}${shortcut ? ` ${shortcut}` : ''}` : undefined}
    title={iconOnly ? `${$_("m.848eed0fbd")}${shortcut ? ` ${shortcut}` : ''}` : undefined}
    on:keydown={handleKeydown}
    on:click={toggle}
  ><i class={`bi ${toolbar ? 'bi-tags' : 'bi-plus-lg'}`} aria-hidden="true"></i>{#if !iconOnly} {toolbar ? $_("m.848eed0fbd") : $_("m.61cc55aa04")}{/if}{#if shortcut}<span class="shortcut-hint"><span class="shortcut-key" class:is-available={shortcutEnabled}>{shortcut}</span></span>{/if}</button>
  {#if open}
    <div class="tag-dropdown">
      <input
        bind:this={searchInput}
        bind:value={search}
        on:keydown={handleKeydown}
        placeholder={$_("m.eb7b580e41")}
        maxlength="51"
        aria-label={$_("m.eb7b580e41")}
      />
      <div class="tag-dropdown-list" aria-label={$_("m.9e704d11d1")}>
        {#each filteredLabels as label (label.id || label.name)}
          <button
            type="button"
            class:is-selected={hasSelected(label.name)}
            aria-pressed={hasSelected(label.name)}
            on:keydown={handleKeydown}
            on:click={() => select(label.name)}
          >
            <span class="label-dot" style={`--label-color:#${tagColorForName(label.name)}`}></span>
            #{label.name}
            {#if hasSelected(label.name)}
              <i class="bi bi-check2 tag-selected-icon" aria-hidden="true"></i>
            {/if}
          </button>
        {/each}
        {#if canCreate}
          <button
            type="button"
            class="create-tag"
            on:keydown={handleKeydown}
            on:click={() => select(newTagName)}
          >
            <span class="label-dot" style={`--label-color:#${tagColorForName(newTagName)}`}></span>
            {$_('dynamic.createTag', { values: { name: newTagName } })}
          </button>
        {:else if !filteredLabels.length}
          <span class="tag-dropdown-empty">{$_("m.c10d35b9eb")}</span>
        {/if}
      </div>
    </div>
  {/if}
</div>
