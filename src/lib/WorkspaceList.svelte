<script>
  import { tick } from 'svelte';
  import { _ } from 'svelte-i18n';
  import TagSettings from './TagSettings.svelte';
  import { workspaceDisplayName } from './settings-storage.js';

  export let workspaces = [];
  export let activeWorkspaceId = '';
  export let onMove = () => {};
  export let onLeave = () => {};
  export let onSwitch = () => {};
  export let onRename = () => {};
  export let tagLabels = [];
  export let tagBusy = false;
  export let onCreateTag = () => {};
  export let onRenameTag = () => {};
  export let onDeleteTag = () => {};
  export let onAddWorkspace = () => {};

  // 설정 화면이 열릴 때마다 이 컴포넌트도 새로 생성되므로, 초기값을 현재
  // 활성 워크스페이스로 두면 "항상 현재는 펼쳐있는" 기본 상태가 된다.
  let expandedId = activeWorkspaceId;
  let renamingId = '';
  let renameDraft = '';
  let renameInput;

  // 펼쳐둔 워크스페이스가 나가기 등으로 목록에서 사라지면 활성 워크스페이스로 되돌린다.
  $: if (expandedId && !workspaces.some((workspace) => workspace.id === expandedId)) {
    expandedId = activeWorkspaceId;
  }

  function toggle(workspaceId) {
    expandedId = expandedId === workspaceId ? '' : workspaceId;
  }

  async function startRename(workspace) {
    renamingId = workspace.id;
    renameDraft = workspaceDisplayName(workspace);
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }

  function cancelRename() {
    renamingId = '';
  }

  function commitRename(workspace) {
    // Escape로 취소한 직후 발생하는 blur까지 저장으로 처리되지 않도록 막는다.
    if (renamingId !== workspace.id) return;
    renamingId = '';
    const next = renameDraft.trim();
    if (!next || next === workspaceDisplayName(workspace)) return;
    onRename(workspace.id, next);
  }
</script>

<ul class="workspace-order-list">
  {#each workspaces as workspace, index (workspace.id)}
    {@const isExpanded = workspace.id === expandedId}
    <li class="workspace-order-item" class:active={workspace.id === activeWorkspaceId} class:expanded={isExpanded}>
      <div class="workspace-order-row">
        {#if renamingId === workspace.id}
          <div class="workspace-order-header workspace-order-rename">
            <i class="bi bi-chevron-right workspace-order-chevron" aria-hidden="true"></i>
            <input
              bind:this={renameInput}
              class="form-control form-control-sm workspace-rename-input"
              value={renameDraft}
              maxlength="80"
              aria-label={$_('dynamic.workspaceDisplayNameLabel', { values: { repo: workspace.repo } })}
              on:input={(event) => (renameDraft = event.currentTarget.value)}
              on:keydown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelRename();
                }
              }}
              on:blur={() => commitRename(workspace)}
            />
          </div>
        {:else}
          <button
            type="button"
            class="workspace-order-header"
            aria-expanded={isExpanded}
            on:click={() => toggle(workspace.id)}
          >
            <i class="bi bi-chevron-right workspace-order-chevron" aria-hidden="true"></i>
            <span class="workspace-order-name">{workspaceDisplayName(workspace)}</span>
            {#if workspace.id === activeWorkspaceId}
              <span class="workspace-order-badge">{$_('workspace.currentBadge')}</span>
            {/if}
          </button>
        {/if}
        <div class="workspace-order-controls">
          <button
            type="button"
            class="workspace-order-icon-btn"
            disabled={index === 0}
            aria-label={$_('workspace.moveUp')}
            title={$_('workspace.moveUp')}
            on:click|stopPropagation={() => onMove(workspace.id, 'up')}
          ><i class="bi bi-chevron-up" aria-hidden="true"></i></button>
          <button
            type="button"
            class="workspace-order-icon-btn"
            disabled={index === workspaces.length - 1}
            aria-label={$_('workspace.moveDown')}
            title={$_('workspace.moveDown')}
            on:click|stopPropagation={() => onMove(workspace.id, 'down')}
          ><i class="bi bi-chevron-down" aria-hidden="true"></i></button>
          <div class="dropdown">
            <button
              type="button"
              class="workspace-order-icon-btn"
              data-bs-toggle="dropdown"
              aria-expanded="false"
              aria-label={$_('workspace.moreActions')}
              title={$_('workspace.moreActions')}
            ><i class="bi bi-three-dots" aria-hidden="true"></i></button>
            <div class="dropdown-menu dropdown-menu-dark dropdown-menu-end">
              <button type="button" class="dropdown-item" on:click={() => startRename(workspace)}>
                <i class="bi bi-pencil" aria-hidden="true"></i> {$_('workspace.rename')}
              </button>
              <button type="button" class="dropdown-item text-danger" on:click={() => onLeave(workspace.id)}>
                <i class="bi bi-box-arrow-right" aria-hidden="true"></i> {$_('workspace.leave')}
              </button>
            </div>
          </div>
        </div>
      </div>
      {#if isExpanded}
        <div class="workspace-order-panel">
          {#if workspace.id === activeWorkspaceId}
            <TagSettings labels={tagLabels} busy={tagBusy} onCreate={onCreateTag} onRename={onRenameTag} onDelete={onDeleteTag} />
          {:else}
            <p class="workspace-order-panel-hint">
              {$_('workspace.switchToManageTags')}
              <button type="button" class="btn btn-outline-secondary" on:click={() => onSwitch(workspace.id)}>
                {$_('workspace.switchAction')}
              </button>
            </p>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ul>
<button type="button" class="btn btn-link" on:click={onAddWorkspace}>
  <i class="bi bi-plus-lg" aria-hidden="true"></i> {$_('workspace.addWorkspace')}
</button>
