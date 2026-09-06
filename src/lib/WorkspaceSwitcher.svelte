<script>
  import { onDestroy, onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { parseRepositoryAddress } from './repo-address.js';
  import { workspaceDisplayName } from './settings-storage.js';

  export let workspaces = [];
  export let activeWorkspaceId = '';
  export let user = null;
  export let busy = false;
  export let onSwitch = () => {};

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

  function workspaceAvatarUrl(workspace) {
    const owner = parseRepositoryAddress(workspace?.repo)?.owner;
    return owner ? `https://github.com/${owner}.png?size=64` : '';
  }

  // 표시명이 없으면 "owner/repo" 전체 대신 저장소명만 제목으로 보여주고, 주소는 항상 아래에 별도 표시한다.
  function workspaceTitle(workspace) {
    const displayName = String(workspace?.displayName || '').trim();
    if (displayName) return displayName;
    return parseRepositoryAddress(workspace?.repo)?.name || workspaceDisplayName(workspace);
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
              {#if workspaceAvatarUrl(workspace)}
                <img class="workspace-repo-avatar" src={workspaceAvatarUrl(workspace)} alt="" aria-hidden="true" loading="lazy" />
              {/if}
              <span class="workspace-repo-text">
                <span class="workspace-repo-name">{workspaceTitle(workspace)}</span>
                {#if workspace.repo}
                  <span class="workspace-repo-address">{workspace.repo}</span>
                {/if}
              </span>
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
