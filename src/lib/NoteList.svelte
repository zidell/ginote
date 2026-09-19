<script>
  import { tick } from 'svelte';
  import { _ } from 'svelte-i18n';
  import NoteListRow from './NoteListRow.svelte';
  import SidebarSearch from './SidebarSearch.svelte';
  import { findEntryForIssue, queuedIssueIds } from './deletion-queue.js';

  const LOAD_MORE_THRESHOLD_PX = 160;

  export let state = 'open';
  export let query = '';
  export let labels = [];
  export let loading = false;
  export let loadingMore = false;
  export let hasMore = false;
  export let searchResultLimitReached = false;
  export let selectionMode = false;
  export let pinnedIssues = [];
  export let issues = [];
  export let emptyMessage = '';
  export let selectedIssueId = null;
  export let keyboardFocusedIssueId = '';
  export let checkedIssueIds = new Set();
  export let refreshingIssueNumber = null;
  export let deletionEntries = [];
  export let listRowFields;
  export let newNoteDisabled = false;
  export let newNoteShortcutAvailable = false;
  export let voiceAvailable = false;
  export let onChangeState = () => {};
  export let onSubmitSearch = () => {};
  export let onSelectLabel = () => {};
  export let onNewNote = () => {};
  export let onVoiceRecording = () => {};
  export let onLoadMore = () => {};
  export let onCancelDeletion = () => {};
  // 목록 행의 포인터·클릭 처리기: { pointerDown, pointerMove, pointerUp, contextMenu, click, selectionClick }
  export let rowHandlers = {};

  let scrollElement;
  let toolsElement;
  // 목록을 내리면 상단 도구(휴지통 탭·검색)를 스크롤한 만큼 밀어 올리고, 맨 위로 오면 다시 보여 준다.
  let toolsOffset = 0;
  let toolsRevealing = false;
  let toolsInitialized = false;
  let toolsInitializing = false;
  let lastScrollTop = 0;

  $: pendingDeletionIds = queuedIssueIds(deletionEntries);
  $: if (scrollElement && toolsElement && !toolsInitialized && !toolsInitializing) initializeTools();

  export function rowButtons() {
    return scrollElement ? Array.from(scrollElement.querySelectorAll('.note-row-hit-area')) : [];
  }

  export function viewportBounds() {
    return scrollElement?.getBoundingClientRect() || null;
  }

  // 워크스페이스를 오갈 때 목록의 스크롤과 도구 위치를 보관했다가 되돌린다.
  export function captureScroll() {
    return { scrollTop: scrollElement?.scrollTop || 0, toolsOffset, toolsRevealing };
  }

  export function restoreScroll(saved) {
    if (!scrollElement || !saved) return;
    scrollElement.scrollTop = saved.scrollTop || 0;
    lastScrollTop = Math.max(0, scrollElement.scrollTop);
    toolsOffset = saved.toolsOffset || 0;
    toolsRevealing = Boolean(saved.toolsRevealing);
  }

  // 처음에는 도구를 숨긴 채로 목록을 보여 준다(도구 높이만큼 내려 둔다).
  async function initializeTools() {
    toolsInitializing = true;
    await tick();

    const element = scrollElement;
    const toolsHeight = toolsElement?.offsetHeight || 0;
    if (!element || !toolsHeight) {
      // 높이를 잴 수 없으면(숨김 등) 숨김 초기화를 건너뛴다. 초기화 중 표시만
      // 되돌리면 위 반응형 구문이 곧바로 다시 호출해 마이크로태스크가 끝없이 돈다.
      toolsInitialized = true;
      toolsInitializing = false;
      return;
    }

    const previousScrollBehavior = element.style.scrollBehavior;
    element.style.scrollBehavior = 'auto';
    element.scrollTop = toolsHeight;
    lastScrollTop = Math.max(0, element.scrollTop);
    toolsOffset = Math.min(toolsHeight, lastScrollTop);
    toolsRevealing = false;
    toolsInitialized = true;

    requestAnimationFrame(() => {
      element.style.scrollBehavior = previousScrollBehavior;
      toolsInitializing = false;
    });
  }

  function handleScroll(event) {
    const element = event.currentTarget;
    const nextScrollTop = Math.max(0, element.scrollTop);
    const delta = nextScrollTop - lastScrollTop;
    const toolsHeight = toolsElement?.offsetHeight || 0;

    if (nextScrollTop <= 0) {
      toolsOffset = 0;
      toolsRevealing = true;
    } else if (delta !== 0) {
      toolsRevealing = false;
      toolsOffset = Math.max(0, Math.min(toolsHeight, toolsOffset + delta));
    }
    lastScrollTop = nextScrollTop;

    if (toolsInitializing) return;

    const distanceFromBottom = element.scrollHeight - nextScrollTop - element.clientHeight;
    if (distanceFromBottom <= LOAD_MORE_THRESHOLD_PX) onLoadMore();
  }
</script>

{#snippet noteRow(issue, pinned)}
  <NoteListRow
    {issue}
    {pinned}
    selected={selectedIssueId === issue.id}
    keyboardFocused={keyboardFocusedIssueId === String(issue.id)}
    {selectionMode}
    checked={checkedIssueIds.has(issue.id)}
    archived={state === 'closed'}
    {listRowFields}
    refreshing={refreshingIssueNumber === issue.number}
    pendingDeletion={pendingDeletionIds.has(issue.id)}
    deletionCancellable={!findEntryForIssue(deletionEntries, issue.id)?.inFlight}
    onCancelDeletion={(pendingIssue) => onCancelDeletion(findEntryForIssue(deletionEntries, pendingIssue.id)?.id)}
    onPointerDown={rowHandlers.pointerDown}
    onPointerMove={rowHandlers.pointerMove}
    onPointerUp={rowHandlers.pointerUp}
    onPointerCancel={rowHandlers.pointerUp}
    onContextMenu={rowHandlers.contextMenu}
    onClick={rowHandlers.click}
    onSelectionClick={rowHandlers.selectionClick}
  />
{/snippet}

<div class="note-list" class:is-loading={loading}>
  <div class="note-list-scroll" bind:this={scrollElement} on:scroll={handleScroll}>
    <div
      class="sidebar-tools"
      class:is-revealing={toolsRevealing}
      bind:this={toolsElement}
      style={`--sidebar-tools-offset:${toolsOffset}px`}
    >
      <div class="state-tabs" role="group" aria-label={$_("m.cd9fe96e05")}>
        <button class="btn btn-sm" class:active={state === 'open'} on:click={() => onChangeState('open')} disabled={selectionMode}>
          <i class="bi bi-journal-text" aria-hidden="true"></i> {$_("m.70440046a3")}
        </button>
        <button class="btn btn-sm" class:active={state === 'closed'} on:click={() => onChangeState('closed')} disabled={selectionMode}>
          <i class="bi bi-trash3" aria-hidden="true"></i> {$_("m.e3bf62bb7f")}
        </button>
      </div>
      <SidebarSearch
        bind:query
        {labels}
        disabled={selectionMode}
        {loading}
        onSubmit={onSubmitSearch}
        {onSelectLabel}
      />
    </div>
    <div class="note-list-body">
      <div class="sidebar-new-note btn-group">
        <button
          class="btn btn-primary btn-sm btn-block flex-grow-1"
          on:click={() => onNewNote()}
          disabled={newNoteDisabled}
        >
          <i class="bi bi-plus-lg" aria-hidden="true"></i> {$_("m.2b7b05c002")}
          <span class="shortcut-hint sidebar-new-note-shortcut" aria-hidden="true"><span class="shortcut-key" class:is-available={newNoteShortcutAvailable}>N</span></span>
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm sidebar-voice-button"
          class:voice-unavailable={!voiceAvailable}
          aria-label="음성 녹음"
          title={voiceAvailable ? '음성 녹음' : 'OpenAI API 키를 지정하면 음성 녹음을 사용할 수 있습니다.'}
          on:click={() => onVoiceRecording()}
          disabled={newNoteDisabled}
        ><i class="bi bi-mic-fill" aria-hidden="true"></i></button>
      </div>
      {#if pinnedIssues.length}
        <div class="note-list-pinned">
          {#each pinnedIssues as issue (issue.id)}
            {@render noteRow(issue, true)}
          {/each}
        </div>
      {/if}
      {#if !loading && issues.length === 0 && pinnedIssues.length === 0}
        <div class="list-status">{emptyMessage}</div>
      {:else}
        {#each issues as issue (issue.id)}
          {@render noteRow(issue, false)}
        {/each}
        {#if hasMore}
          <div class="list-load-more">
            <button class="btn btn-sm btn-link text-secondary" disabled={loadingMore} on:click={() => onLoadMore()}>
              {#if loadingMore}
                <span class="spinner-border spinner-border-sm region-spinner" aria-hidden="true"></span>
              {:else}
                <i class="bi bi-chevron-down" aria-hidden="true"></i>
              {/if}
              {$_("m.dfe60ca92e")}
            </button>
          </div>
        {/if}
        {#if searchResultLimitReached && !hasMore}
          <div class="list-status">{$_('dynamic.searchResultLimit')}</div>
        {/if}
      {/if}
    </div>
  </div>
  {#if loading}
    <div class="list-api-overlay" aria-label={$_("m.6e6e21803f")}>
      <span class="spinner-border spinner-border-sm region-spinner" aria-hidden="true"></span>
    </div>
  {/if}
</div>
