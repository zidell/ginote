<script>
  import { onDestroy, onMount, tick } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { parseRepositoryAddress } from './repo-address.js';
  import { truncateMiddle, workspaceDisplayName } from './settings-storage.js';

  export let workspaces = [];
  export let activeWorkspaceId = '';
  export let user = null;
  export let busy = false;
  export let onSwitch = () => {};

  let open = false;
  let switcher;
  let toggleButton;
  let dropdownStyle = '';
  let highlightedIndex = -1;

  $: activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  $: activeWorkspaceName = workspaceDisplayName(activeWorkspace);
  $: activeWorkspaceLabel = truncateMiddle(activeWorkspaceName);

  onMount(() => {
    document.addEventListener('pointerdown', handleOutside);
    // App.svelte에도 전역 키보드 핸들러가 있으므로 캡처 단계에서 먼저
    // 드롭다운 키를 처리해 노트 목록의 ↑/↓/Enter 단축키와 충돌하지 않게 한다.
    window.addEventListener('keydown', handleGlobalKeydown, true);
  });
  onDestroy(() => {
    document.removeEventListener('pointerdown', handleOutside);
    window.removeEventListener('keydown', handleGlobalKeydown, true);
  });

  function toggle() {
    if (busy || !user) return;
    open = !open;
    // 사이드바 헤더가 overflow: hidden이라 absolute로는 드롭다운이 잘려서 fixed로 위치를 직접 계산한다.
    if (open) {
      const rect = toggleButton.getBoundingClientRect();
      dropdownStyle = `top: ${rect.bottom + 6}px; left: ${rect.left}px;`;
      highlightedIndex = activeWorkspaceIndex();
      focusHighlightedOption();
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

  function activeWorkspaceIndex() {
    const index = workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId);
    return index === -1 ? (workspaces.length ? 0 : -1) : index;
  }

  function focusHighlightedOption() {
    tick().then(() => {
      if (!open) return;
      const options = switcher?.querySelectorAll('[role="option"]');
      const option = options?.[highlightedIndex];
      option?.focus();
    });
  }

  function moveHighlight(direction) {
    if (!workspaces.length) return;
    const currentIndex = highlightedIndex >= 0 ? highlightedIndex : activeWorkspaceIndex();
    highlightedIndex = Math.max(0, Math.min(workspaces.length - 1, currentIndex + direction));
    focusHighlightedOption();
  }

  function isTypingTarget(element) {
    return element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
      || element?.isContentEditable;
  }

  function isBackquote(event) {
    return event.key === '`' || event.code === 'Backquote';
  }

  function workspaceNumberFromEvent(event) {
    const keyMatch = /^[1-9]$/.exec(event.key);
    const codeMatch = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
    return Number(keyMatch?.[0] || codeMatch?.[1] || 0);
  }

  function handleGlobalKeydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;

    if (isBackquote(event)) {
      // 입력 중인 백틱은 노트·검색어에 입력할 수 있어야 한다.
      if (!open && isTypingTarget(document.activeElement)) return;
      if (busy || !user) return;
      event.preventDefault();
      event.stopPropagation();
      toggle();
      return;
    }

    if (!open) return;

    const workspaceNumber = workspaceNumberFromEvent(event);
    if (workspaceNumber) {
      event.preventDefault();
      event.stopPropagation();
      const workspace = workspaces[workspaceNumber - 1];
      if (workspace) select(workspace.id);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (event.key === 'Enter') {
      const workspace = workspaces[highlightedIndex];
      if (!workspace) return;
      event.preventDefault();
      event.stopPropagation();
      select(workspace.id);
    }
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
    aria-keyshortcuts="Backquote"
    aria-label={$_('workspace.switcherLabel')}
    disabled={busy || !user}
    on:click={toggle}
  >
    {#if user}
      <img class="avatar" src={user.avatar_url} alt={user.login} />
    {/if}
    <span class="sidebar-profile-name" title={activeWorkspaceName}>{activeWorkspaceLabel}</span>
    <span class="shortcut-hint sidebar-profile-shortcut" aria-hidden="true"><span class="shortcut-key" class:is-available={!busy && Boolean(user)}>&#96;</span></span>
  </button>
  {#if open}
    <div class="workspace-dropdown" style={dropdownStyle}>
      <div class="workspace-dropdown-list" role="listbox" aria-label={$_('workspace.switcherLabel')}>
        {#each workspaces as workspace, index (workspace.id)}
          <div
            class="workspace-dropdown-item"
            class:active={workspace.id === activeWorkspaceId}
            class:keyboard-focused={index === highlightedIndex}
          >
            <button
              type="button"
              role="option"
              tabindex={index === highlightedIndex ? 0 : -1}
              aria-selected={workspace.id === activeWorkspaceId}
              aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
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
              <span class="workspace-shortcut" aria-hidden="true"><span class="shortcut-key">{index + 1}</span></span>
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
