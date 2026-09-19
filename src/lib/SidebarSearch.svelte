<script>
  import { _ } from 'svelte-i18n';

  export let query = '';
  export let labels = [];
  export let disabled = false;
  export let loading = false;
  export let onSubmit = () => {};
  export let onSelectLabel = () => {};

  let focused = false;
  let suggestionIndex = -1;

  $: suggestions = labels.filter((label) =>
    label.name.toLocaleLowerCase().includes(query.trim().replace(/^#/, '').toLocaleLowerCase())
  );

  function closeSuggestions() {
    focused = false;
    suggestionIndex = -1;
  }

  function submit() {
    closeSuggestions();
    onSubmit();
  }

  function selectLabel(label) {
    closeSuggestions();
    onSelectLabel(label);
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      closeSuggestions();
      return;
    }
    if (!suggestions.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    if (event.key === 'Enter' && suggestionIndex < 0) return;
    event.preventDefault();
    if (event.key === 'ArrowDown') {
      focused = true;
      suggestionIndex = (suggestionIndex + 1) % suggestions.length;
    } else if (event.key === 'ArrowUp') {
      focused = true;
      suggestionIndex = suggestionIndex <= 0 ? suggestions.length - 1 : suggestionIndex - 1;
    } else {
      selectLabel(suggestions[suggestionIndex]);
    }
  }
</script>

<div class="sidebar-search">
  <form class="input-group" on:submit|preventDefault={submit}>
    <input
      class="form-control form-control-sm"
      type="search"
      role="combobox"
      bind:value={query}
      placeholder={$_("m.55a302a1a9")}
      aria-label={$_("m.2bca6e4c82")}
      aria-autocomplete="list"
      aria-controls="sidebar-label-suggestions"
      aria-expanded={focused && suggestions.length > 0}
      on:focus={() => focused = true}
      on:input={() => suggestionIndex = -1}
      on:keydown={handleKeydown}
      on:blur={() => focused = false}
      {disabled}
    />
    <button class="btn btn-sm" disabled={loading || disabled}><i class="bi bi-search" aria-hidden="true"></i> {$_("m.bce0641417")}</button>
  </form>
  {#if !disabled && focused && suggestions.length > 0}
    <div class="sidebar-label-suggestions" id="sidebar-label-suggestions" role="listbox">
      {#each suggestions as label, index (label.id || label.name)}
        <button
          type="button"
          role="option"
          aria-selected={suggestionIndex === index}
          class:active={suggestionIndex === index}
          on:mousedown|preventDefault
          on:click={() => selectLabel(label)}
        >#{label.name}</button>
      {/each}
    </div>
  {/if}
</div>
