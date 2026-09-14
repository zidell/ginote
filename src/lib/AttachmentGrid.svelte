<script>
  import BrailleSpinner from './BrailleSpinner.svelte';

  export let attachments = [];
  export let uploadingAttachments = [];
  export let loadingAttachmentCount = 0;
  export let previewUrls = {};
  export let isImage = () => false;
  export let onOpen = () => {};
  export let onRemove = null;
  export let deletingPath = '';
  export let pendingDeletes = new Map();
  export let onCancelDelete = () => {};
  export let editable = false;
  export let previewMode = false;
  export let deleteLabel = (attachment) => `Delete ${attachment.name}`;
  export let showAdd = false;
  export let addLabel = 'Add attachment';
  export let addDisabled = false;
  export let onAdd = () => {};
</script>

<div class="attachment-list">
  {#each Array(loadingAttachmentCount) as _, index (index)}
    <div class="attachment-loading-placeholder" aria-hidden="true">
      <span class="attachment-loading"><span class="attachment-spinner"><BrailleSpinner active /></span></span>
    </div>
  {/each}
  {#each attachments as attachment, index (attachment.path)}
    <div
      class="attachment-item"
      class:is-loading={deletingPath === attachment.path}
      class:is-pending-delete={pendingDeletes.has(attachment.path)}
    >
      <button
        type="button"
        class="attachment-open"
        disabled={Boolean(deletingPath) || pendingDeletes.has(attachment.path)}
        on:click={() => onOpen(attachment, index)}
      >
        {#if deletingPath === attachment.path}
          <span class="attachment-loading"><span class="attachment-spinner"><BrailleSpinner active /></span></span>
        {:else if isImage(attachment)}
          {#if previewUrls[attachment.path]}
            <img src={previewUrls[attachment.path]} alt="" />
          {:else}
            <span class="attachment-loading"><span class="attachment-spinner"><BrailleSpinner active /></span></span>
          {/if}
        {:else}
          <span class="attachment-file-icon">FILE</span>
        {/if}
        <span class="attachment-name" title={attachment.name}>{attachment.name}</span>
      </button>
      {#if pendingDeletes.has(attachment.path)}
        <div class="attachment-pending-delete" role="status">
          <span class="attachment-spinner"><BrailleSpinner active /></span>
          <span>Deleting…</span>
          {#if deletingPath !== attachment.path && editable && !previewMode}
            <button type="button" class="attachment-cancel-delete" on:click|stopPropagation={() => onCancelDelete(attachment)}>Cancel</button>
          {/if}
        </div>
      {:else if onRemove && editable && !previewMode}
        <button type="button" class="attachment-delete" disabled={Boolean(deletingPath)} on:click={() => onRemove(attachment)} aria-label={deleteLabel(attachment)}>
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      {/if}
    </div>
  {/each}
  {#each uploadingAttachments as attachment (attachment.id)}
    <div class="attachment-item attachment-uploading" role="status">
      <span class="attachment-loading"><span class="attachment-spinner"><BrailleSpinner active /></span></span>
      <span class="attachment-name" title={attachment.name}>{attachment.name}</span>
    </div>
  {/each}
  {#if showAdd}
    <button type="button" class="attachment-add-tile" class:disabled={addDisabled} disabled={addDisabled} on:click={onAdd}>
      <strong><i class="bi bi-plus-lg" aria-hidden="true"></i></strong>
      <span>{addLabel}</span>
    </button>
  {/if}
</div>
