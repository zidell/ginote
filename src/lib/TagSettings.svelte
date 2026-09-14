<script>
  import { onDestroy, tick } from 'svelte';
  import BrailleSpinner from './BrailleSpinner.svelte';
  import { tagColorForName } from './colors.js';
  import { formatTagDefinition, parseTagDefinition } from './tag-definition.js';
  import { visibleLabels as filterVisibleLabels } from './pin-label.js';
  import { _ } from 'svelte-i18n';

  export let labels = [];
  export let busy = '';
  export let onCreate = () => {};
  export let onRename = () => {};
  export let onDelete = () => {};

  let drafts = {};
  let pendingSaves = {};
  let lastSubmitted = {};
  let newName = '';
  let newNameInput;

  $: manageableLabels = filterVisibleLabels(labels);

  function draftKey(label) {
    return String(label?.id || label?.name || '').toLocaleLowerCase();
  }

  function draftValue(label) {
    return drafts[draftKey(label)] ?? formatTagDefinition(label);
  }

  function updateDraft(label, value) {
    drafts = { ...drafts, [draftKey(label)]: value };
  }

  function clearDraft(label) {
    const { [draftKey(label)]: removed, ...remainingDrafts } = drafts;
    drafts = remainingDrafts;
  }

  function setSaving(label, amount) {
    const key = draftKey(label);
    const count = Math.max(0, (pendingSaves[key] || 0) + amount);
    if (count) pendingSaves = { ...pendingSaves, [key]: count };
    else {
      const { [key]: completed, ...remaining } = pendingSaves;
      pendingSaves = remaining;
    }
  }

  // 입력이 끝난 시점(blur·Enter)에만 이름 변경을 보내, 타이핑 도중 이름이 바뀌지 않게 한다.
  function commitRename(label) {
    const next = parseTagDefinition(draftValue(label), label);
    if (next.name === label.name && next.description === String(label.description || '').trim()) {
      clearDraft(label);
      return;
    }
    const submittedValue = draftValue(label);
    const key = draftKey(label);
    if (lastSubmitted[key] === submittedValue) return;
    lastSubmitted = { ...lastSubmitted, [key]: submittedValue };
    setSaving(label, 1);
    void Promise.resolve(onRename(label, next))
      .then((saved) => {
        // 저장을 기다리는 동안 같은 입력칸을 다시 바꾼 경우, 나중 입력을 지우지 않는다.
        if (saved && drafts[draftKey(label)] === submittedValue) clearDraft(label);
      })
      .finally(() => setSaving(label, -1));
  }

  // blur 없이 설정을 닫아도 input 이벤트로 쌓인 초안을 저장 큐에 넣는다.
  onDestroy(() => manageableLabels.forEach((label) => commitRename(label)));

  function deleteLabel(label) {
    clearDraft(label);
    onDelete(label);
  }

  async function create() {
    const tag = parseTagDefinition(newName);
    if (!tag.name) return;
    await onCreate(tag);
    newName = '';
    await tick();
    newNameInput?.focus();
  }
</script>

<fieldset class="editor-settings tag-settings mb-4">
  <legend>{$_("m.b2f3136b1a")}</legend>
  <div class="tag-settings-create">
    <input
      bind:this={newNameInput}
      class="form-control form-control-sm"
      bind:value={newName}
      maxlength="151"
      placeholder={$_('dynamic.tagDefinition')}
      disabled={Boolean(busy?.creating)}
      aria-label={$_('dynamic.tagDefinition')}
      on:keydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          create();
        }
      }}
    />
    <button type="button" class="btn btn-sm btn-outline-secondary" disabled={Boolean(busy?.creating) || !newName.trim()} on:click={create}>
      <i class="bi bi-plus-lg" aria-hidden="true"></i> {$_("m.61cc55aa04")}
    </button>
  </div>
  {#if manageableLabels.length}
    <div class="tag-settings-list">
      {#each manageableLabels as label (label.id || label.name)}
        <div class="tag-settings-row">
          <span class="label-dot" style={`--label-color:#${tagColorForName(label.name)}`}></span>
          <div class="tag-settings-input" aria-busy={Boolean(pendingSaves[draftKey(label)])}>
            <input
              class="form-control form-control-sm"
              value={draftValue(label)}
              maxlength="151"
              aria-label={$_('dynamic.tagName', { values: { name: label.name } })}
              on:input={(event) => updateDraft(label, event.currentTarget.value)}
              on:change={() => commitRename(label)}
              on:keydown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
            <span class="tag-settings-saving"><BrailleSpinner active={Boolean(pendingSaves[draftKey(label)])} /></span>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-outline-danger"
            disabled={Boolean(pendingSaves[draftKey(label)])}
            on:click={() => deleteLabel(label)}
          ><i class="bi bi-trash3" aria-hidden="true"></i> {$_("m.f6fdbe48dc")}</button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="small text-secondary mb-0">{$_("m.2240ffb750")}</p>
  {/if}
</fieldset>
