<script>
  import { onDestroy, onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { externalLinkTarget } from './external-links.js';
  import { workspaceDisplayName } from './settings-storage.js';

  export let workspaces = [];
  export let activeWorkspaceId = '';
  export let user = null;
  export let repositoryIssuesUrl = '';
  export let busy = false;
  export let onSwitch = () => {};

  const externalTarget = externalLinkTarget();
  let open = false;
  let switcher;
  let toggleButton;
  let dropdownStyle = '';

  onMount(() => document.addEventListener('pointerdown', handleOutside));
  onDestroy(() => document.removeEventListener('pointerdown', handleOutside));

  function toggle() {
    if (busy || !user) return;
    open = !open;
    // 사이드바 헤더가 overflow: hidden이라 absolute로는 드롭다운이 잘려서 fixed로 위치를 직접 계산한다.
    if (open) {
      const rect = toggleButton.getBoundingClientRect();
      dropdownStyle = `top: ${rect.bottom + 6}px; left: ${rect.left}px;`;
    }
  }

  function close() {
    open = false;
  }

  function handleOutside(event) {
    if (open && !switcher?.contains(event.target)) close();
  }

  function select(workspaceId) {
    close();
    if (workspaceId !== activeWorkspaceId) onSwitch(workspaceId);
  }
</script>

<div class="workspace-switcher" bind:this={switcher}>
  <button
    bind:this={toggleButton}
    type="button"
    class="sidebar-profile"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={$_('workspace.switcherLabel')}
    disabled={busy || !user}
    on:click={toggle}
  >
    {#if user}
      <img class="avatar" src={user.avatar_url} alt={user.login} />
    {/if}
  </button>
  {#if open}
    <div class="workspace-dropdown" style={dropdownStyle}>
      <div class="workspace-dropdown-list" role="listbox" aria-label={$_('workspace.switcherLabel')}>
        {#each workspaces as workspace (workspace.id)}
          <div class="workspace-dropdown-item" class:active={workspace.id === activeWorkspaceId}>
            <button
              type="button"
              role="option"
              aria-selected={workspace.id === activeWorkspaceId}
              on:click={() => select(workspace.id)}
            >
              <i class="bi bi-check-lg workspace-active-icon" aria-hidden="true"></i>
              <span class="workspace-repo-name">{workspaceDisplayName(workspace)}</span>
            </button>
            {#if workspace.id === activeWorkspaceId && repositoryIssuesUrl}
              <a
                class="workspace-external-link"
                href={repositoryIssuesUrl}
                target={externalTarget}
                rel="noreferrer"
                aria-label={$_('workspace.openOnGitHub')}
                title={$_('workspace.openOnGitHub')}
              >
                <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
              </a>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
