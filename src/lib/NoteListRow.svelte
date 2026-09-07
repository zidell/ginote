<script>
  import BrailleSpinner from './BrailleSpinner.svelte';
  import { tagColorForName } from './colors.js';
  import { markdownToPlainText } from './notes.js';
  import { isLockedTitle, removeLockFromTitle } from './note-lock.js';
  import { _, locale as activeLocale } from 'svelte-i18n';

  export let issue;
  export let pinned = false;
  export let selected = false;
  export let keyboardFocused = false;
  export let selectionMode = false;
  export let checked = false;
  export let archived = false;
  export let listRowFields = { title: true, summary: true, meta: true, tags: true };
  export let refreshing = false;
  export let pendingDeletion = false;
  export let onPointerDown = () => {};
  export let onPointerMove = () => {};
  export let onPointerUp = () => {};
  export let onPointerCancel = () => {};
  export let onContextMenu = () => {};
  export let onClick = () => {};
  export let onSelectionClick = () => {};

  function labelColor(label) {
    return tagColorForName(label?.name);
  }

  function excerpt(body, title = '') {
    const plainBody = markdownToPlainText(body);
    const plainTitle = markdownToPlainText(title);
    const text = plainTitle && plainBody.startsWith(plainTitle)
      ? plainBody.slice(plainTitle.length).trimStart()
      : plainBody;
    return text || $_("m.0c3fd88e60");
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat($activeLocale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }
</script>

<article
  class="note-list-row"
  class:active={selected}
  class:keyboard-focused={keyboardFocused}
  class:selection-mode={selectionMode}
  class:selected={checked}
  class:is-archived={archived}
  class:pending-deletion={pendingDeletion}
  aria-busy={refreshing || pendingDeletion}
  on:pointerdown={(event) => onPointerDown(event, issue)}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointercancel={onPointerCancel}
  on:contextmenu={(event) => onContextMenu(event, issue)}
>
  {#if selectionMode && !issue.local}
    <input
      class="form-check-input note-row-checkbox"
      type="checkbox"
      {checked}
      aria-label={$_('dynamic.openNote', { values: { title: issue.title } })}
      on:click|stopPropagation={(event) => onSelectionClick(event, issue)}
    />
  {/if}
  <button
    class="note-row-hit-area"
    data-issue-id={issue.id}
    on:click={(event) => onClick(event, issue)}
    aria-label={$_('dynamic.openNote', { values: { title: issue.title } })}
  ></button>
  <div class="note-row-content">
    {#if listRowFields.title}
      <span class="note-row-title">
        {#if pinned}<i class="bi bi-pin-angle-fill note-row-pin" aria-hidden="true"></i>{/if}
        {#if isLockedTitle(issue.title)}<i class="bi bi-lock-fill note-row-lock" aria-hidden="true"></i>{/if}
        {markdownToPlainText(removeLockFromTitle(issue.title))}
      </span>
    {/if}
    {#if listRowFields.summary}
      <span class="note-row-preview">{isLockedTitle(issue.title) ? '잠금된 노트입니다' : excerpt(issue.body, issue.title)}</span>
    {/if}
    {#if listRowFields.meta}
      <span class="note-row-meta">
        {issue.local ? $_("m.6f65454664") : `#${issue.number} · ${formatDate(issue.updated_at)}`}
      </span>
    {/if}
  </div>
  {#if listRowFields.tags && issue.labels?.length}
    <div class="note-row-labels">
      {#each issue.labels as label (label.id || label.name)}
        <span style={`--tag-color:#${labelColor(label)}`}>#{label.name}</span>
      {/each}
    </div>
  {/if}
  {#if refreshing || pendingDeletion}
    <span class="note-row-refresh-spinner" aria-label={$_("m.6e6e21803f")}>
      <BrailleSpinner active />
    </span>
  {/if}
</article>
