<script>
  import { onMount, tick } from 'svelte';
  import { createStackRouter } from 'spa-stack-router';
  import { externalLinkTarget } from './lib/external-links.js';
  import McpGuide from './lib/McpGuide.svelte';
  import NoteEditor from './lib/NoteEditor.svelte';
  import NoteListRow from './lib/NoteListRow.svelte';
  import SetupWizard from './lib/SetupWizard.svelte';
  import TagSettings from './lib/TagSettings.svelte';
  import WorkspaceList from './lib/WorkspaceList.svelte';
  import WorkspaceSwitcher from './lib/WorkspaceSwitcher.svelte';
  import { tagColorForName } from './lib/colors.js';
  import { localFontFamily, localFontValue } from './lib/editor-fonts.js';
  import { _, locale as activeLocale } from 'svelte-i18n';
  import { LOCALE_OPTIONS, setAppLocale } from './lib/i18n.js';
  import { normalizeTagName } from './lib/notes.js';
  import { makePatCreationUrl, normalizeToken, parseRepositoryAddress } from './lib/repo-address.js';
  import {
    BACKGROUND_REFRESH_DEFAULT_MINUTES,
    BACKGROUND_REFRESH_OPTIONS,
    LOCK_SESSION_DEFAULT_MINUTES,
    LOCK_SESSION_OPTIONS,
    WORKSPACE_CACHE_DEFAULT_MINUTES,
    WORKSPACE_CACHE_OPTIONS,
    clampNumber,
    createWorkspaceRecord,
    loadSettingsDocument,
    normalizeBackgroundRefreshMinutes,
    normalizeLockSessionMinutes,
    normalizeWorkspaceCacheMinutes,
    preferenceSignature,
    renameWorkspace as renameWorkspaceRecord,
    reorderWorkspace,
    saveSettingsDocument,
    workspaceDisplayName
  } from './lib/settings-storage.js';
  import {
    getCachedIssueList,
    invalidateCachedIssueList,
    setCachedIssueList
  } from './lib/issue-cache.js';
  import {
    loadPinnedNotes,
    MAX_PINNED_NOTES,
    replacePinnedNoteSnapshot,
    savePinnedNotes,
    togglePinnedNote
  } from './lib/pinned-notes-storage.js';
  import {
    createIssue,
    createLabel,
    listExpiredClosedIssues,
    listIssuesPage,
    listLabels,
    removeLabel,
    renameLabel,
    purgeIssueAttachments,
    searchIssuesPage,
    setIssueLabels,
    setIssueState,
    verifyConnection
  } from './lib/github.js';

  const ATTACHMENT_PRUNE_STORAGE_KEY = 'issue-note.attachment-prune.v1';
  const SIDEBAR_WIDTH_STORAGE_KEY = 'issue-note.sidebar-width.v1';
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
  const ATTACHMENT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const SIDEBAR_LOAD_MORE_THRESHOLD_PX = 160;
  const SIDEBAR_WIDTH_MIN = 200;
  const SIDEBAR_WIDTH_MAX = 600;
  const SIDEBAR_WIDTH_DEFAULT = 340;
  const router = createStackRouter({ mode: 'hashbang', escToBack: true });
  const newContextTarget = externalLinkTarget();

  let token = '';
  let tokenInputValue = '';
  let repo = '';
  let rememberToken = true;
  let workspaces = [];
  let activeWorkspaceId = '';
  let workspaceWizardOpen = false;
  let workspaceWizardKey = 0;
  let workspaceWizardRepo = '';
  let workspaceWizardToken = '';
  let workspaceWizardRememberToken = true;
  let workspaceWizardBusy = false;
  let workspaceWizardError = '';
  let appState = 'booting';
  let user = null;
  let repository = null;
  let issues = [];
  let pinnedIssues = [];
  let repositoryLabels = [];
  let selectedIssue = null;
  let keyboardFocusedIssueId = '';
  let keyboardEnteredIssueId = '';
  const lastOpenedIssueIds = new Map();
  let pendingNote = null;
  let pendingAllocation = null;
  // 새 노트가 번호를 받아 정식 이슈로 바뀌는 순간 NoteEditor가 (segment가
  // new→note.{번호}로 바뀌므로) 리마운트된다. 그 인스턴스가 계속 이어서
  // 타이핑할 수 있도록 딱 그 첫 렌더에서만 포커스를 넣어준다.
  let justPromotedNumber = null;
  let editorFocusRequest = 0;
  let externalPasteRequest = null;
  let pasteRequestSequence = 0;
  let pruningExpiredAttachments = false;
  let state = 'open';
  let query = '';
  let appliedQuery = '';
  let activeLabel = '';
  let loading = false;
  let loadingMore = false;
  let issuePage = 1;
  let hasMoreIssues = false;
  let totalIssues = 0;
  let error = '';
  let notice = '';
  let routeStack = [];
  let titleMode = 'first-line';
  let listRowFields = { title: true, summary: true, meta: true, tags: true };
  let editorFont = 'system';
  let localFontFamilies = [];
  let localFontLoadState = 'idle';
  let editorFontSize = 17;
  let editorLineHeight = 1.8;
  let editorMaxWidth = 840;
  let autoSaveSeconds = 5;
  let issuePageSize = 30;
  let backgroundRefreshMinutes = BACKGROUND_REFRESH_DEFAULT_MINUTES;
  let lockSessionMinutes = LOCK_SESSION_DEFAULT_MINUTES;
  let workspaceCacheMinutes = WORKSPACE_CACHE_DEFAULT_MINUTES;
  let touchDevice = false;
  let languagePreference = 'auto';
  let backgroundRefreshTimer;
  let labelBusy = '';
  let labelMutation = null;
  let labelMutationSequence = 0;
  let settingsRouteOverride = '';
  let settingsEntryPageSize = 0;
  let settingsEntrySignature = '';
  let toastMessage = '';
  let toastTimer;
  let toastSequence = 0;
  let sidebarWidth = SIDEBAR_WIDTH_DEFAULT;
  let sidebarResizing = false;
  let sidebarScrollElement;
  let sidebarToolsElement;
  let sidebarToolsOffset = 0;
  let sidebarToolsRevealing = false;
  let sidebarToolsInitialized = false;
  let sidebarToolsInitializing = false;
  let sidebarSearchFocused = false;
  let sidebarSuggestionIndex = -1;
  let lastSidebarScrollTop = 0;
  let issueRefreshSequence = 0;
  let issueRefreshRequests = {};
  let refreshingIssueNumber = null;
  let pendingRouteTransition = null;
  let hasConfirmedPatStorage = false;
  let lockPin = '';
  let lockSessionTimer;
  let selectedIssueIds = new Set();
  let selectionAnchorId = null;
  let selectionTagPanelOpen = false;
  let selectionTagSearch = '';
  let selectionTagBusy = false;
  let longPressTimer;
  let longPressStart = null;
  let suppressIssueClickId = null;
  let suppressIssueClickTimer;

  $: selectionMode = selectedIssueIds.size > 0;
  $: selectedIssues = visibleIssues.filter((issue) => !issue.local && selectedIssueIds.has(issue.id));
  $: selectionTagCounts = countSelectionTags(selectedIssues);
  $: selectionTagOptions = buildSelectionTagOptions(
    repositoryLabels,
    selectionTagCounts,
    selectionTagSearch
  );
  $: selectionNewTagName = normalizeTagName(selectionTagSearch);
  $: canCreateSelectionTag = Boolean(selectionNewTagName)
    && !selectionTagOptions.some((option) => option.name.toLocaleLowerCase() === selectionNewTagName.toLocaleLowerCase());
  $: if (!selectionMode && selectionTagPanelOpen) closeSelectionTagPanel();

  $: emptyMessage = appliedQuery
    ? $_("m.e9cc6d0e9a")
    : state === 'open'
      ? $_("m.f5dd983c9d")
      : $_("m.123eda8d5e");
  $: patCreationUrl = makePatCreationUrl(repo);
  $: guideRepository = parseRepositoryAddress(repo);
  $: mcpRepository = repository?.full_name || guideRepository?.fullName || repo.trim();
  $: mcpUsagePrompt = $_('dynamic.mcpPrompt', {
    values: { repo: mcpRepository || 'owner/repository', issueNumber: '{issue number}' }
  });
  $: topRoute = routeStack.at(-1);
  $: contentRoutes = routeStack.filter((route) => ['note', 'new'].includes(route.screen));
  $: contentRoute = contentRoutes.at(-1);
  $: isNewRoute = contentRoute?.screen === 'new';
  $: queryIsLabelFilter = queryMatchesActiveLabel(appliedQuery, activeLabel);
  $: pendingMatchesLabel = !activeLabel || hasIssueLabel(pendingNote, activeLabel);
  $: visibleIssues = pendingNote && state === 'open' && (!appliedQuery || queryIsLabelFilter) && pendingMatchesLabel
    ? [pendingNote, ...issues.filter((issue) => issue.number !== pendingNote.number)]
    : issues;
  $: pinnedIssueIds = new Set(pinnedIssues.map((issue) => issue.id));
  $: unpinnedVisibleIssues = visibleIssues.filter((issue) => !pinnedIssueIds.has(issue.id));
  $: displayedIssueCount = pendingNote && state === 'open' && (!appliedQuery || queryIsLabelFilter) && pendingMatchesLabel
    ? Math.max(totalIssues, pendingNote.countBaseline + 1)
    : totalIssues;
  $: sidebarLabelSuggestions = repositoryLabels.filter((label) =>
    label.name.toLocaleLowerCase().includes(query.trim().replace(/^#/, '').toLocaleLowerCase())
  );
  $: if (sidebarScrollElement && sidebarToolsElement && !sidebarToolsInitialized && !sidebarToolsInitializing) {
    initializeSidebarTools();
  }
  $: if (!sidebarScrollElement && sidebarToolsInitialized) {
    sidebarToolsInitialized = false;
    sidebarToolsOffset = 0;
    lastSidebarScrollTop = 0;
  }

  function setLockSession(pin) {
    clearTimeout(lockSessionTimer);
    lockPin = pin;
    if (!pin) return;
    lockSessionTimer = setTimeout(() => {
      lockPin = '';
    }, lockSessionMinutes * 60 * 1000);
  }

  onMount(() => {
    const touchMedia = matchMedia('(pointer: coarse)');
    const updateTouchDevice = () => touchDevice = touchMedia.matches;
    updateTouchDevice();
    touchMedia.addEventListener('change', updateTouchDevice);
    sidebarWidth = loadSidebarWidth();
    router.init();
    window.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('paste', handleGlobalPaste);
    const unsubscribe = router.subscribe((stack) => {
      const targetSignature = stack.map((route) => route.segment).join('/');
      if (targetSignature === pendingRouteTransition) return;
      const hadContent = routeStack.some((route) => ['note', 'new'].includes(route.screen));
      const hasContent = stack.some((route) => ['note', 'new'].includes(route.screen));
      // 목록으로 나갈 때의 모든 경로(버튼, Esc, 브라우저 뒤로가기)에서 현재
      // 입력 포커스를 전환 스냅샷 전에 해제한다.
      if (hadContent && !hasContent) document.activeElement?.blur?.();
      const transitionDirection = !hadContent && hasContent
        ? 'forward'
        : hadContent && !hasContent ? 'backward' : '';

      if (shouldAnimateNoteTransition(transitionDirection)) {
        pendingRouteTransition = targetSignature;
        document.documentElement.dataset.noteTransition = transitionDirection;
        const transition = document.startViewTransition(async () => {
          updateRouteStack(stack);
          await tick();
        });
        const clearTransitionDirection = () => {
          if (pendingRouteTransition !== targetSignature) return;
          pendingRouteTransition = null;
          delete document.documentElement.dataset.noteTransition;
        };
        transition.finished.then(clearTransitionDirection, clearTransitionDirection);
        return;
      }

      updateRouteStack(stack);
    });

    function updateRouteStack(stack) {
      const wasInSettings = routeStack.at(-1)?.screen === 'settings';
      const isInSettings = stack.at(-1)?.screen === 'settings';
      const previousLabel = labelFromRoutes(routeStack);
      const nextLabel = labelFromRoutes(stack);
      routeStack = stack;
      activeLabel = nextLabel;
      if (previousLabel !== nextLabel) {
        if (nextLabel) {
          query = `#${nextLabel}`;
          appliedQuery = query;
        } else {
          if (queryMatchesActiveLabel(query, previousLabel)) query = '';
          if (queryMatchesActiveLabel(appliedQuery, previousLabel)) appliedQuery = '';
        }
      }
      if (wasInSettings && !isInSettings) {
        applySettingsChanges();
        if (settingsRouteOverride) {
          const target = settingsRouteOverride;
          settingsRouteOverride = '';
          router.navigate(`/${target}`);
          return;
        }
      }
      applyRoute();
      if (previousLabel !== nextLabel && appState === 'ready' && !isInSettings) loadIssues();
    }

    const settingsDocument = loadSettingsDocument();
    if (settingsDocument) {
      workspaces = settingsDocument.workspaces;
      activeWorkspaceId = settingsDocument.activeWorkspaceId;
      pinnedIssues = loadPinnedNotes(activeWorkspaceId);
      ({
        titleMode,
        listRowFields,
        editorFont,
        editorFontSize,
        editorLineHeight,
        editorMaxWidth,
        autoSaveSeconds,
        issuePageSize,
        backgroundRefreshMinutes,
        lockSessionMinutes,
        workspaceCacheMinutes,
        language: languagePreference
      } = settingsDocument.preferences);
      setAppLocale(languagePreference);
      const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
      if (activeWorkspace) {
        repo = activeWorkspace.repo;
        token = activeWorkspace.token;
        // PAT가 아직 없는 첫 실행에도 기본값은 저장으로 둔다. 실제 저장 여부는
        // 연결 직전에 개인용 디바이스인지 한 번 더 확인한다.
        rememberToken = activeWorkspace.rememberToken;
      }
      if (token && repo) {
        connect(false, true);
      } else {
        appState = 'setup';
      }
    } else {
      appState = 'setup';
    }

    restartBackgroundRefreshTimer();

    return () => {
      clearInterval(backgroundRefreshTimer);
      clearTimeout(lockSessionTimer);
      clearTimeout(longPressTimer);
      clearTimeout(suppressIssueClickTimer);
      clearTimeout(toastTimer);
      touchMedia.removeEventListener('change', updateTouchDevice);
      window.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('paste', handleGlobalPaste);
      unsubscribe();
      router.destroy();
    };
  });

  function shouldAnimateNoteTransition(direction) {
    return Boolean(
      direction
      && appState === 'ready'
      && document.startViewTransition
      && matchMedia('(max-width: 991.98px)').matches
    );
  }

  function applyRoute() {
    const route = [...routeStack].reverse().find((item) => ['note', 'new'].includes(item.screen));

    // 새 노트는 번호 할당 직후 주소가 note.{번호}로 바뀌지만 issues 목록에는
    // 아직 없다. 이 경우를 "삭제된 옛날 URL"로 오인해 홈으로 되돌리면 안 되므로
    // pendingNote와 대조해 먼저 처리한다.
    if (isPendingNoteRoute(route)) {
      selectedIssue = pendingNote;
      return;
    }

    if (route?.screen === 'note') {
      const issueNumber = Number(route.value);
      selectedIssue = issues.find((issue) => issue.number === issueNumber) || null;
      if (selectedIssue) lastOpenedIssueIds.set(activeWorkspaceId, selectedIssue.id);
      // 삭제됐거나 더는 현재 목록에 없는 이슈의 오래된 URL은 본문 레이어를
      // 비워 두지 않는다. 첫 목록 요청이 끝난 뒤 홈 목록으로 되돌린다.
      // 설정 화면이 떠 있는 동안에는 미루고, 닫을 때 다시 판단한다.
      if (!selectedIssue && appState === 'ready' && !loading && topRoute?.screen !== 'settings') {
        router.navigate('/');
      }
      return;
    }

    selectedIssue = null;
  }

  function issueForRoute(route) {
    if (route.screen === 'new') return null;
    const issueNumber = Number(route.value);
    return issues.find((issue) => issue.number === issueNumber) || null;
  }

  // 새 노트는 번호를 배경에서 미리 받아오는 즉시 주소도 note.{번호}로 바꿔서
  // 새로고침해도 같은 이슈를 이어쓰게 한다. 이 시점엔 아직 issues 목록에는
  // 없으므로, 그 사이의 note.{번호} 라우트도 pendingNote 기준으로는 여전히
  // "새 노트 세션"으로 취급해야 초안·할당된 이슈 정보를 계속 물려줄 수 있다.
  function isPendingNoteRoute(route) {
    if (!route) return false;
    if (route.screen === 'new') return true;
    return route.screen === 'note' && pendingNote != null && Number(route.value) === pendingNote.number;
  }

  function labelFromRoutes(routes) {
    const route = routes.find((item) => item.screen === 'tag');
    if (!route?.value) return '';
    try {
      return decodeURIComponent(route.value);
    } catch {
      return route.value;
    }
  }

  function queryMatchesActiveLabel(queryValue, labelName) {
    return Boolean(
      labelName
      && queryValue.trim().toLocaleLowerCase() === `#${labelName}`.toLocaleLowerCase()
    );
  }

  function currentPreferences() {
    return {
      titleMode,
      listRowFields,
      editorFont,
      editorFontSize,
      editorLineHeight,
      editorMaxWidth,
      autoSaveSeconds,
      issuePageSize,
      backgroundRefreshMinutes,
      lockSessionMinutes,
      workspaceCacheMinutes,
      language: languagePreference
    };
  }

  function persistSettings(normalizedRepo) {
    const existingIndex = workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId);
    const existingDisplayName = existingIndex === -1 ? '' : workspaces[existingIndex].displayName;
    const workspaceRecord = {
      id: activeWorkspaceId || crypto.randomUUID(),
      repo: normalizedRepo,
      token,
      rememberToken,
      displayName: existingDisplayName || ''
    };
    workspaces = existingIndex === -1
      ? [...workspaces, workspaceRecord]
      : workspaces.map((workspace, index) => (index === existingIndex ? workspaceRecord : workspace));
    activeWorkspaceId = workspaceRecord.id;
    saveSettingsDocument({ workspaces, activeWorkspaceId, preferences: currentPreferences() });
  }

  function restartBackgroundRefreshTimer() {
    clearInterval(backgroundRefreshTimer);
    if (!backgroundRefreshMinutes) return;
    backgroundRefreshTimer = setInterval(() => {
      if (appState === 'ready' && topRoute?.screen !== 'settings') loadIssues(true);
    }, backgroundRefreshMinutes * 60 * 1000);
  }

  function loadSidebarWidth() {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      if (raw === null) return SIDEBAR_WIDTH_DEFAULT;
      return clampNumber(raw, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_DEFAULT);
    } catch {
      return SIDEBAR_WIDTH_DEFAULT;
    }
  }

  function persistSidebarWidth(width) {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // 폭 저장에 실패해도 현재 세션 사용에는 지장이 없다.
    }
  }

  function startSidebarResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    sidebarResizing = true;

    function handleMove(moveEvent) {
      sidebarWidth = clampNumber(
        startWidth + (moveEvent.clientX - startX),
        SIDEBAR_WIDTH_MIN,
        SIDEBAR_WIDTH_MAX,
        SIDEBAR_WIDTH_DEFAULT
      );
    }

    function handleUp() {
      sidebarResizing = false;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      persistSidebarWidth(sidebarWidth);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function shouldPruneExpiredAttachments() {
    try {
      const lastPruned = Number(JSON.parse(localStorage.getItem(ATTACHMENT_PRUNE_STORAGE_KEY) || '{}')[repo]);
      return !Number.isFinite(lastPruned) || Date.now() - lastPruned >= ATTACHMENT_PRUNE_INTERVAL_MS;
    } catch {
      return true;
    }
  }

  function markExpiredAttachmentsPruned() {
    try {
      const prunedByRepository = JSON.parse(localStorage.getItem(ATTACHMENT_PRUNE_STORAGE_KEY) || '{}');
      prunedByRepository[repo] = Date.now();
      localStorage.setItem(ATTACHMENT_PRUNE_STORAGE_KEY, JSON.stringify(prunedByRepository));
    } catch {
      // 정리 완료 시각을 기록하지 못해도 다음 연결 시 안전하게 다시 확인한다.
    }
  }

  async function pruneExpiredAttachments() {
    if (pruningExpiredAttachments || !shouldPruneExpiredAttachments()) return;
    pruningExpiredAttachments = true;
    const requestedToken = token;
    const requestedRepo = repo;
    try {
      const expiredIssues = await listExpiredClosedIssues(requestedToken, requestedRepo);
      for (const expiredIssue of expiredIssues) {
        if (selectedIssue?.number === expiredIssue.number) continue;
        await purgeIssueAttachments(requestedToken, requestedRepo, expiredIssue.number);
      }
      if (token === requestedToken && repo === requestedRepo) markExpiredAttachmentsPruned();
    } catch {
      // 백그라운드 정리 실패는 노트 사용 흐름을 방해하지 않고 다음 연결 때 재시도한다.
    } finally {
      pruningExpiredAttachments = false;
    }
  }

  function friendlyError(reason) {
    if (reason?.status === 401) return $_("m.faea518485");
    if (reason?.status === 404) return $_("m.ff34a34522");
    if (reason?.status === 403 && reason?.remaining === '0') {
      return $_("m.27ef201e27");
    }
    if (reason?.status === 403) return $_("m.26096781ad");
    return reason?.message || $_("m.285cc7fd9a");
  }

  async function connect(showSuccess = true, restoring = false) {
    if (!restoring && appState === 'setup' && rememberToken && !hasConfirmedPatStorage) {
      if (!confirm($_('setup.confirmPatStorage'))) return;
      hasConfirmedPatStorage = true;
    }
    const requestedToken = normalizeToken(tokenInputValue) || token;
    const requestedRepo = repo;
    error = '';
    notice = '';
    appState = restoring ? 'restoring' : 'connecting';
    try {
      const result = await verifyConnection(requestedToken, requestedRepo);
      token = requestedToken;
      tokenInputValue = '';
      repo = result.repo;
      user = result.user;
      repository = result.repository;
      persistSettings(result.repo);
      restartBackgroundRefreshTimer();
      if (showSuccess) notice = $_("m.2273eb0763");
      await Promise.all([loadIssues(), loadRepositoryLabels()]);
      appState = 'ready';
      applyRoute();
      pruneExpiredAttachments();
    } catch (reason) {
      appState = 'setup';
      error = friendlyError(reason);
    }
  }

  async function switchWorkspace(workspaceId) {
    if (!workspaceId || workspaceId === activeWorkspaceId) return;
    const target = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!target) return;

    // 나가는 워크스페이스의 목록/필터 상태를 캐시해 다시 돌아왔을 때 즉시 보여준다(stale-while-revalidate).
    setCachedIssueList(activeWorkspaceId, {
      issues, repositoryLabels, issuePage, hasMoreIssues, totalIssues,
      state, query, appliedQuery, activeLabel,
      openNoteSegment: contentRoute?.screen === 'note' ? contentRoute.segment : '',
      sidebarScrollTop: sidebarScrollElement?.scrollTop || 0,
      sidebarToolsOffset,
      sidebarToolsRevealing
    });

    clearIssueSelection();
    selectedIssue = null;
    keyboardFocusedIssueId = '';
    keyboardEnteredIssueId = '';
    pendingNote = null;
    pendingAllocation = null;
    // 이전 워크스페이스 요청의 로딩 표시가 새 목록 위에 남지 않게 초기화한다.
    loading = false;
    loadingMore = false;
    state = 'open';
    query = '';
    appliedQuery = '';
    activeLabel = '';

    activeWorkspaceId = workspaceId;
    pinnedIssues = loadPinnedNotes(workspaceId);
    token = target.token;
    repo = target.repo;
    rememberToken = target.rememberToken;
    user = null;
    repository = null;
    error = '';
    notice = '';
    saveSettingsDocument({ workspaces, activeWorkspaceId, preferences: currentPreferences() });

    const cached = getCachedIssueList(workspaceId, workspaceCacheMinutes);
    if (cached) {
      ({ issues, repositoryLabels, issuePage, hasMoreIssues, totalIssues, state, query, appliedQuery, activeLabel } = cached);
      appState = 'ready';
      // 유효 기간 안의 캐시라면 그 워크스페이스에서 마지막으로 열던 노트도 되돌린다.
      router.navigate(cached.openNoteSegment ? `/${cached.openNoteSegment}` : '/');
      await tick();
      if (sidebarScrollElement) {
        sidebarScrollElement.scrollTop = cached.sidebarScrollTop || 0;
        lastSidebarScrollTop = Math.max(0, sidebarScrollElement.scrollTop);
        sidebarToolsOffset = cached.sidebarToolsOffset || 0;
        sidebarToolsRevealing = Boolean(cached.sidebarToolsRevealing);
      }
    } else {
      issues = [];
      repositoryLabels = [];
      // 이미 인증된 워크스페이스로 전환하는 것뿐이므로, 최초 설정용 스텝바이스텝
      // 마법사(appState 'connecting') 대신 부팅 시 자동 재연결과 같은 가벼운
      // 로딩 화면(appState 'restoring')을 보여준다.
      appState = 'restoring';
      router.navigate('/');
    }

    try {
      const result = await verifyConnection(token, repo);
      user = result.user;
      repository = result.repository;
      appState = 'ready';
      restartBackgroundRefreshTimer();
      // 캐시로 이미 목록을 보여준 상태라면 로딩 스피너 없이 조용히 갱신한다.
      await Promise.all([loadIssues(Boolean(cached)), loadRepositoryLabels()]);
      applyRoute();
      pruneExpiredAttachments();
    } catch (reason) {
      appState = cached ? 'ready' : 'setup';
      error = friendlyError(reason);
    }
  }

  async function completeAddWorkspace({ repo: newRepo, token: newToken, rememberToken: remember }) {
    const result = await verifyConnection(newToken, newRepo);
    const record = createWorkspaceRecord({ repo: result.repo, token: newToken, rememberToken: remember });
    workspaces = [...workspaces, record];
    await switchWorkspace(record.id);
  }

  function openAddWorkspaceWizard() {
    workspaceWizardKey += 1;
    workspaceWizardRepo = '';
    workspaceWizardToken = '';
    workspaceWizardRememberToken = true;
    workspaceWizardError = '';
    workspaceWizardOpen = true;
  }

  function closeAddWorkspaceWizard() {
    if (workspaceWizardBusy) return;
    workspaceWizardOpen = false;
  }

  async function submitAddWorkspace() {
    workspaceWizardBusy = true;
    workspaceWizardError = '';
    try {
      await completeAddWorkspace({
        repo: workspaceWizardRepo,
        token: normalizeToken(workspaceWizardToken),
        rememberToken: workspaceWizardRememberToken
      });
      workspaceWizardOpen = false;
    } catch (reason) {
      workspaceWizardError = friendlyError(reason);
    } finally {
      workspaceWizardBusy = false;
    }
  }

  function forgetWorkspace(workspaceId) {
    workspaces = workspaces.filter((workspace) => workspace.id !== workspaceId);
    invalidateCachedIssueList(workspaceId);
    saveSettingsDocument({ workspaces, activeWorkspaceId, preferences: currentPreferences() });
    if (activeWorkspaceId !== workspaceId) return;
    const next = workspaces[0];
    if (next) {
      switchWorkspace(next.id);
      return;
    }
    activeWorkspaceId = '';
    token = '';
    tokenInputValue = '';
    repo = '';
    user = null;
    repository = null;
    issues = [];
    pinnedIssues = [];
    totalIssues = 0;
    repositoryLabels = [];
    pendingNote = null;
    selectedIssue = null;
    appState = 'setup';
    router.navigate('/');
  }

  function moveWorkspace(workspaceId, direction) {
    workspaces = reorderWorkspace(workspaces, workspaceId, direction);
    saveSettingsDocument({ workspaces, activeWorkspaceId, preferences: currentPreferences() });
  }

  function renameWorkspace(workspaceId, displayName) {
    workspaces = renameWorkspaceRecord(workspaces, workspaceId, displayName);
    saveSettingsDocument({ workspaces, activeWorkspaceId, preferences: currentPreferences() });
  }

  function leaveWorkspace(workspaceId) {
    const target = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!target) return;
    const repoLabel = workspaceDisplayName(target);
    if (!confirm($_('workspace.leaveConfirm', { values: { repo: repoLabel } }))) return;
    forgetWorkspace(workspaceId);
    notice = $_('workspace.leftNotice', { values: { repo: repoLabel } });
  }

  async function loadIssues(background = false) {
    if (background && loading) return;
    const requestedWorkspaceId = activeWorkspaceId;
    const requestedQuery = appliedQuery;
    const requestedState = state;
    const requestedLabel = activeLabel;
    const requestedTerm = queryMatchesActiveLabel(requestedQuery, requestedLabel) ? '' : requestedQuery;
    if (!background) {
      error = '';
      loading = true;
    }
    try {
      const result = requestedTerm.trim()
        ? await searchIssuesPage(token, repo, requestedState, requestedTerm, requestedLabel, 1, Date.now(), issuePageSize)
        : await listIssuesPage(token, repo, requestedState, requestedLabel, 1, Date.now(), issuePageSize);
      if (
        requestedWorkspaceId !== activeWorkspaceId
        ||
        requestedQuery !== appliedQuery
        || requestedState !== state
        || requestedLabel !== activeLabel
      ) return;
      if (background && issuePage > 1) {
        const refreshedIds = new Set(result.items.map((issue) => issue.id));
        issues = [...result.items, ...issues.filter((issue) => !refreshedIds.has(issue.id))];
      } else {
        issues = result.items;
        issuePage = 1;
        hasMoreIssues = result.hasMore;
      }
      reconcileIssueSelection(issues);
      if (result.totalCount !== null) totalIssues = result.totalCount;
      applyRoute();
    } catch (reason) {
      if (!background && requestedWorkspaceId === activeWorkspaceId) error = friendlyError(reason);
    } finally {
      if (!background && requestedWorkspaceId === activeWorkspaceId) loading = false;
    }
  }

  async function loadMoreIssues() {
    if (loading || loadingMore || !hasMoreIssues) return;
    const requestedWorkspaceId = activeWorkspaceId;
    const requestedQuery = appliedQuery;
    const requestedState = state;
    const requestedLabel = activeLabel;
    const requestedTerm = queryMatchesActiveLabel(requestedQuery, requestedLabel) ? '' : requestedQuery;
    const nextPage = issuePage + 1;
    loadingMore = true;
    error = '';
    try {
      const result = requestedTerm.trim()
        ? await searchIssuesPage(token, repo, requestedState, requestedTerm, requestedLabel, nextPage, Date.now(), issuePageSize)
        : await listIssuesPage(token, repo, requestedState, requestedLabel, nextPage, Date.now(), issuePageSize);
      if (
        requestedWorkspaceId !== activeWorkspaceId
        ||
        requestedQuery !== appliedQuery
        || requestedState !== state
        || requestedLabel !== activeLabel
      ) return;
      const knownIds = new Set(issues.map((issue) => issue.id));
      issues = [...issues, ...result.items.filter((issue) => !knownIds.has(issue.id))];
      issuePage = nextPage;
      hasMoreIssues = result.hasMore;
      if (result.totalCount !== null) totalIssues = result.totalCount;
      applyRoute();
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      if (requestedWorkspaceId === activeWorkspaceId) loadingMore = false;
    }
  }

  async function submitSearch() {
    sidebarSearchFocused = false;
    sidebarSuggestionIndex = -1;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      query = '';
      appliedQuery = '';
      if (activeLabel) {
        clearLabel();
        return;
      }
      await loadIssues();
      return;
    }

    const tagQuery = normalizedQuery.match(/^#(.+)$/)?.[1]?.trim();
    if (tagQuery) {
      const exactLabel = repositoryLabels.find(
        (label) => label.name.toLocaleLowerCase() === tagQuery.toLocaleLowerCase()
      );
      if (exactLabel) {
        query = `#${exactLabel.name}`;
        appliedQuery = query;
        if (activeLabel.toLocaleLowerCase() === exactLabel.name.toLocaleLowerCase()) {
          await loadIssues();
          return;
        }
        openLabel(exactLabel.name);
        return;
      }
    }
    query = normalizedQuery;
    appliedQuery = normalizedQuery;
    if (activeLabel) {
      clearLabel();
      return;
    }
    await loadIssues();
  }

  function selectSidebarLabel(label) {
    query = `#${label.name}`;
    sidebarSearchFocused = false;
    sidebarSuggestionIndex = -1;
  }

  function handleSidebarSearchKeydown(event) {
    if (event.key === 'Escape') {
      sidebarSearchFocused = false;
      sidebarSuggestionIndex = -1;
      return;
    }
    if (!sidebarLabelSuggestions.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    if (event.key === 'Enter' && sidebarSuggestionIndex < 0) return;
    event.preventDefault();
    if (event.key === 'ArrowDown') {
      sidebarSearchFocused = true;
      sidebarSuggestionIndex = (sidebarSuggestionIndex + 1) % sidebarLabelSuggestions.length;
    } else if (event.key === 'ArrowUp') {
      sidebarSearchFocused = true;
      sidebarSuggestionIndex = sidebarSuggestionIndex <= 0
        ? sidebarLabelSuggestions.length - 1
        : sidebarSuggestionIndex - 1;
    } else {
      selectSidebarLabel(sidebarLabelSuggestions[sidebarSuggestionIndex]);
    }
  }

  async function loadRepositoryLabels() {
    const requestedWorkspaceId = activeWorkspaceId;
    try {
      const labels = await listLabels(token, repo);
      if (requestedWorkspaceId !== activeWorkspaceId) return;
      repositoryLabels = labels;
    } catch (reason) {
      if (requestedWorkspaceId === activeWorkspaceId) error = friendlyError(reason);
    }
  }

  async function changeState(nextState) {
    if (state === nextState) return;
    clearIssueSelection();
    state = nextState;
    query = '';
    appliedQuery = '';
    selectedIssue = null;
    const labelWillChange = Boolean(activeLabel);
    if (router.getDepth()) router.navigate('/');
    if (!labelWillChange) await loadIssues();
  }

  async function initializeSidebarTools() {
    sidebarToolsInitializing = true;
    await tick();

    const scrollElement = sidebarScrollElement;
    const toolsHeight = sidebarToolsElement?.offsetHeight || 0;
    if (!scrollElement || !toolsHeight) {
      sidebarToolsInitializing = false;
      return;
    }

    const previousScrollBehavior = scrollElement.style.scrollBehavior;
    scrollElement.style.scrollBehavior = 'auto';
    scrollElement.scrollTop = toolsHeight;
    lastSidebarScrollTop = Math.max(0, scrollElement.scrollTop);
    sidebarToolsOffset = Math.min(toolsHeight, lastSidebarScrollTop);
    sidebarToolsRevealing = false;
    sidebarToolsInitialized = true;

    requestAnimationFrame(() => {
      scrollElement.style.scrollBehavior = previousScrollBehavior;
      sidebarToolsInitializing = false;
    });
  }

  function handleSidebarScroll(event) {
    const scrollElement = event.currentTarget;
    const nextScrollTop = Math.max(0, scrollElement.scrollTop);
    const delta = nextScrollTop - lastSidebarScrollTop;
    const toolsHeight = sidebarToolsElement?.offsetHeight || 0;

    if (nextScrollTop <= 0) {
      sidebarToolsOffset = 0;
      sidebarToolsRevealing = true;
    } else if (delta !== 0) {
      sidebarToolsRevealing = false;
      sidebarToolsOffset = Math.max(0, Math.min(toolsHeight, sidebarToolsOffset + delta));
    }
    lastSidebarScrollTop = nextScrollTop;

    if (sidebarToolsInitializing) return;

    const distanceFromBottom = scrollElement.scrollHeight - nextScrollTop - scrollElement.clientHeight;
    if (distanceFromBottom <= SIDEBAR_LOAD_MORE_THRESHOLD_PX) void loadMoreIssues();
  }

  function newNote(initialBody = '', { ignoreRecoveredDraft = true } = {}) {
    const pastedBody = typeof initialBody === 'string' ? initialBody : '';
    error = '';
    const stateChanged = state !== 'open';
    const hadQuery = Boolean(appliedQuery.trim());
    state = 'open';
    query = activeLabel ? `#${activeLabel}` : '';
    appliedQuery = query;
    if (!pendingNote) {
      pendingNote = {
        // 세션마다 고유해야 한다. 타이핑할 때마다 pendingNote가 스프레드로
        // 재생성되므로(참조가 바뀜), 나중에 도착하는 allocatePendingIssue
        // 콜백은 참조 대신 이 id로 "그때 그 세션이 맞는지" 대조한다. 고정
        // 문자열이면 다음 새 노트 세션과 혼동될 수 있다.
        id: `local-new-note-${crypto.randomUUID()}`,
        number: null,
        title: $_("m.2b7b05c002"),
        body: pastedBody,
        ignoreRecoveredDraft,
        labels: activeLabel ? [{ name: activeLabel }] : [],
        updated_at: new Date().toISOString(),
        local: true,
        countBaseline: totalIssues,
        allocation: 'creating'
      };
      pendingAllocation = allocatePendingIssue(pendingNote);
    }
    selectedIssue = pendingNote;
    if (topRoute?.screen === 'note') {
      router.replace('new');
    } else {
      router.navigate('new');
    }
    if (hadQuery || stateChanged) loadIssues();
  }

  function handleGlobalKeydown(event) {
    const workspaceNumber = workspaceNumberFromEvent(event);
    if (event.key === 'Escape' && helpTopic) {
      event.preventDefault();
      closeHelp();
      return;
    }
    if (event.key === 'Escape' && selectionMode) {
      event.preventDefault();
      clearIssueSelection();
      return;
    }
    if (
      canUseKeyboardListNavigation()
      && isNoteRowButton(document.activeElement)
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && event.shiftKey
      && ['ArrowDown', 'ArrowUp'].includes(event.key)
    ) {
      event.preventDefault();
      extendIssueSelection(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (
      selectionMode
      && state === 'open'
      && isNoteRowButton(document.activeElement)
      && !event.repeat
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && ['Delete', 'Backspace'].includes(event.key)
    ) {
      event.preventDefault();
      moveSelectedIssues();
      return;
    }
    if (
      canUseListKeyboardShortcuts()
      && hasNoInteractiveFocus()
      && !event.repeat
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && !event.isComposing
      && workspaceNumber
    ) {
      const workspace = workspaces[workspaceNumber - 1];
      if (!workspace) return;
      event.preventDefault();
      switchWorkspace(workspace.id);
      return;
    }
    if (
      canUseListKeyboardShortcuts()
      && !event.repeat
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && event.key === 'Enter'
      && isNoteRowButton(document.activeElement)
    ) {
      const issueId = document.activeElement.dataset.issueId;
      const issue = [...pinnedIssues, ...unpinnedVisibleIssues].find((item) => String(item.id) === issueId);
      if (!issue) return;
      event.preventDefault();
      if (keyboardEnteredIssueId === issueId) {
        editorFocusRequest += 1;
        return;
      }
      keyboardEnteredIssueId = issueId;
      // 열람으로 들어갈 때는 목록 행의 실제 포커스를 해제한다. 점선은 별도 상태로 유지된다.
      document.activeElement?.blur?.();
      selectNote(issue);
      return;
    }
    if (
      canUseListKeyboardShortcuts()
      && isKeyboardEnteredNoteSelection()
      && !event.repeat
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && event.key === 'Enter'
      && ['note', 'new'].includes(contentRoute?.screen)
    ) {
      event.preventDefault();
      editorFocusRequest += 1;
      return;
    }
    if (
      canUseListKeyboardShortcuts()
      && !event.repeat
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && ['ArrowDown', 'ArrowUp'].includes(event.key)
      && (hasNoInteractiveFocus() || isNoteRowButton(document.activeElement))
    ) {
      event.preventDefault();
      moveNoteRowFocus(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (
      canUseListKeyboardShortcuts()
      && hasNoInteractiveFocus()
      && !event.repeat
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && !event.isComposing
      && event.key.toLocaleLowerCase() === 'n'
    ) {
      event.preventDefault();
      newNote();
      return;
    }
  }

  function canUseListKeyboardShortcuts() {
    return !selectionMode && canUseKeyboardListNavigation();
  }

  function canUseKeyboardListNavigation() {
    const isHomeOrNote = routeStack.length === 0
      || /^#!\/?$/.test(window.location.hash)
      || contentRoute?.screen === 'note'
      || /^#!\/note\.\d+$/.test(window.location.hash);
    return (
      appState === 'ready'
      && topRoute?.screen !== 'settings'
      && !workspaceWizardOpen
      && !helpTopic
      && isHomeOrNote
    );
  }

  function hasNoInteractiveFocus() {
    return document.activeElement === document.body;
  }

  function isKeyboardEnteredNoteSelection() {
    return document.activeElement === document.body
      && Boolean(keyboardFocusedIssueId)
      && keyboardEnteredIssueId === keyboardFocusedIssueId;
  }

  function workspaceNumberFromEvent(event) {
    const keyMatch = /^[1-9]$/.exec(event.key);
    const codeMatch = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
    return Number(keyMatch?.[0] || codeMatch?.[1] || 0);
  }

  function isNoteRowButton(element) {
    return element instanceof HTMLElement && element.classList.contains('note-row-hit-area');
  }

  function noteRowButtons() {
    return sidebarScrollElement
      ? Array.from(sidebarScrollElement.querySelectorAll('.note-row-hit-area'))
      : [];
  }

  function moveNoteRowFocus(direction) {
    const buttons = noteRowButtons();
    if (!buttons.length) return;

    const focusedIndex = buttons.indexOf(document.activeElement);
    let targetIndex = focusedIndex;
    if (targetIndex === -1) {
      const lastOpenedIssueId = lastOpenedIssueIds.get(activeWorkspaceId);
      const lastOpenedIndex = buttons.findIndex((button) => button.dataset.issueId === String(lastOpenedIssueId));
      if (lastOpenedIndex !== -1) {
        targetIndex = lastOpenedIndex + direction;
      } else {
        const containerBounds = sidebarScrollElement.getBoundingClientRect();
        targetIndex = buttons.findIndex((button) => {
          const bounds = button.getBoundingClientRect();
          return bounds.bottom > containerBounds.top && bounds.top < containerBounds.bottom;
        });
      }
    } else {
      targetIndex += direction;
    }

    if (targetIndex < 0 || targetIndex >= buttons.length) return;
    const target = buttons[targetIndex];
    keyboardFocusedIssueId = target.dataset.issueId || '';
    keyboardEnteredIssueId = '';
    target.scrollIntoView({ block: 'nearest' });
    target.focus({ preventScroll: true });
  }

  function extendIssueSelection(direction) {
    const buttons = noteRowButtons();
    const currentIndex = buttons.indexOf(document.activeElement);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= buttons.length) return;

    const orderedIssues = [...pinnedIssues, ...unpinnedVisibleIssues];
    const currentIssueId = buttons[currentIndex].dataset.issueId;
    if (selectionAnchorId === null) selectionAnchorId = currentIssueId;
    const anchorIndex = orderedIssues.findIndex((issue) => String(issue.id) === String(selectionAnchorId));
    if (anchorIndex < 0) {
      selectionAnchorId = currentIssueId;
      return;
    }

    const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b);
    selectedIssueIds = new Set(
      orderedIssues
        .slice(start, end + 1)
        .filter((issue) => !issue.local)
        .map((issue) => issue.id)
    );

    const target = buttons[targetIndex];
    keyboardFocusedIssueId = target.dataset.issueId || '';
    keyboardEnteredIssueId = '';
    target.scrollIntoView({ block: 'nearest' });
    target.focus({ preventScroll: true });
  }

  function handleGlobalPaste(event) {
    if (appState !== 'ready' || topRoute?.screen === 'settings' || isEditableElement(event.target)) return;

    const files = Array.from(event.clipboardData?.files || []);
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!files.length && !text) return;

    event.preventDefault();
    if (contentRoute) {
      if (files.length && state === 'open') {
        notice = '';
        queueExternalPaste(files);
      }
      else if (text) notice = $_('dynamic.pasteLocationRequired');
      return;
    }

    notice = '';
    newNote(text, { ignoreRecoveredDraft: true });
    if (files.length) queueExternalPaste(files);
  }

  function isEditableElement(element) {
    return element instanceof HTMLTextAreaElement
      || element instanceof HTMLInputElement
      || Boolean(element?.isContentEditable);
  }

  function queueExternalPaste(files) {
    externalPasteRequest = { id: ++pasteRequestSequence, files };
  }

  function externalPasteHandled(id) {
    if (externalPasteRequest?.id === id) externalPasteRequest = null;
  }

  async function allocatePendingIssue(localNote) {
    try {
      const created = await createIssue(token, repo, {
        title: $_("m.2b7b05c002"),
        body: '',
        labels: localNote.labels.map((label) => label.name)
      });
      // localNote.id로 대조하는 이유: 사용자가 타이핑하면 noteDraftChanged가
      // pendingNote를 스프레드로 매번 재생성해 참조(===)가 바뀐다. id는
      // newNote()에서 세션마다 새로 발급하므로(crypto.randomUUID), 그 사이에
      // 이 세션이 이미 취소되고(예: 워크스페이스 전환) 다른 새 노트 세션이
      // 시작됐어도 서로 혼동되지 않는다.
      if (pendingNote === localNote || pendingNote?.id === localNote.id) {
        // 번호가 확보된 순간 바로 정식 생성으로 취급한다. 아무것도 입력하지
        // 않아도 "새 노트" 버튼이 계속 막혀 있지 않도록. 그사이 실제로 입력된
        // 내용이 있으면 빈 할당 응답 대신 그 내용을 그대로 반영한다.
        noteCreated({
          ...created,
          title: pendingNote.title || created.title,
          body: pendingNote.body || created.body,
          labels: pendingNote.labels?.length ? pendingNote.labels : created.labels
        });
      }
      return created;
    } catch (reason) {
      if (pendingNote === localNote || pendingNote?.id === localNote.id) {
        pendingNote = { ...pendingNote, allocation: 'failed' };
        if (isNewRoute) selectedIssue = pendingNote;
      }
      error = $_('dynamic.allocateFailed', { values: { error: friendlyError(reason) } });
      return null;
    }
  }

  function selectNote(issue) {
    if (!issue.local) {
      refreshingIssueNumber = issue.number;
      issueRefreshRequests = { [issue.number]: ++issueRefreshSequence };
    }
    router.navigate(issue.local ? 'new' : `note.${issue.number}`);
  }

  function beginIssueLongPress(event, issue) {
    if (selectionMode || issue.local || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    cancelIssueLongPress();
    longPressStart = {
      pointerId: event.pointerId,
      issueId: issue.id,
      x: event.clientX,
      y: event.clientY
    };
    longPressTimer = setTimeout(() => {
      if (longPressStart?.issueId !== issue.id) return;
      selectedIssueIds = new Set([issue.id]);
      selectionAnchorId = issue.id;
      suppressIssueClickId = issue.id;
      clearTimeout(suppressIssueClickTimer);
      suppressIssueClickTimer = setTimeout(() => {
        suppressIssueClickId = null;
      }, 1000);
      navigator.vibrate?.(20);
      previewSelectedIssue(issue);
    }, LONG_PRESS_MS);
  }

  function trackIssueLongPress(event) {
    if (!longPressStart || event.pointerId !== longPressStart.pointerId) return;
    if (
      Math.abs(event.clientX - longPressStart.x) > LONG_PRESS_MOVE_TOLERANCE_PX
      || Math.abs(event.clientY - longPressStart.y) > LONG_PRESS_MOVE_TOLERANCE_PX
    ) cancelIssueLongPress();
  }

  function cancelIssueLongPress() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
  }

  function finishIssueLongPress(event) {
    if (longPressStart?.pointerId === event.pointerId) cancelIssueLongPress();
  }

  function handleIssueContextMenu(event, issue) {
    if (selectionMode || suppressIssueClickId === issue.id) event.preventDefault();
  }

  function handleIssueClick(event, issue) {
    if (suppressIssueClickId === issue.id) {
      event.preventDefault();
      suppressIssueClickId = null;
      clearTimeout(suppressIssueClickTimer);
      return;
    }
    if (selectionMode) {
      event.preventDefault();
      if (toggleIssueSelection(issue, event.shiftKey)) previewSelectedIssue(issue);
      return;
    }
    if (event.shiftKey && selectedIssue && !selectedIssue.local && !issue.local && selectedIssue.id !== issue.id) {
      event.preventDefault();
      selectionAnchorId = selectedIssue.id;
      if (toggleIssueSelection(issue, true)) previewSelectedIssue(issue);
      return;
    }
    selectNote(issue);
  }

  function toggleIssueSelection(issue, selectRange = false) {
    if (issue.local) return false;
    const nextSelected = new Set(selectedIssueIds);
    if (selectRange && selectionAnchorId !== null) {
      const selectableIssues = visibleIssues.filter((item) => !item.local);
      const anchorIndex = selectableIssues.findIndex((item) => item.id === selectionAnchorId);
      const issueIndex = selectableIssues.findIndex((item) => item.id === issue.id);
      if (anchorIndex >= 0 && issueIndex >= 0) {
        const [start, end] = [anchorIndex, issueIndex].sort((a, b) => a - b);
        for (const item of selectableIssues.slice(start, end + 1)) nextSelected.add(item.id);
      } else {
        nextSelected.add(issue.id);
      }
    } else if (nextSelected.has(issue.id)) {
      nextSelected.delete(issue.id);
    } else {
      nextSelected.add(issue.id);
    }

    selectedIssueIds = nextSelected;
    if (nextSelected.size === 0) selectionAnchorId = null;
    else if (!selectRange) selectionAnchorId = issue.id;
    return nextSelected.has(issue.id);
  }

  function handleIssueSelectionClick(event, issue) {
    if (toggleIssueSelection(issue, event.shiftKey)) previewSelectedIssue(issue);
  }

  function previewSelectedIssue(issue) {
    if (!matchMedia('(min-width: 992px)').matches) return;
    selectNote(issue);
  }

  function clearIssueSelection() {
    cancelIssueLongPress();
    closeSelectionTagPanel();
    selectedIssueIds = new Set();
    selectionAnchorId = null;
    suppressIssueClickId = null;
    clearTimeout(suppressIssueClickTimer);
  }

  function reconcileIssueSelection(nextIssues) {
    if (!selectedIssueIds.size) return;
    const availableIds = new Set(nextIssues.filter((issue) => !issue.local).map((issue) => issue.id));
    const nextSelected = new Set([...selectedIssueIds].filter((id) => availableIds.has(id)));
    if (nextSelected.size === selectedIssueIds.size) return;
    selectedIssueIds = nextSelected;
    if (!nextSelected.has(selectionAnchorId)) selectionAnchorId = nextSelected.values().next().value ?? null;
  }

  function moveSelectedIssues() {
    if (!selectedIssues.length) {
      clearIssueSelection();
      return;
    }
    const nextState = state === 'open' ? 'closed' : 'open';
    const movedIssues = selectedIssues;
    clearIssueSelection();
    for (const issue of movedIssues) moveIssue(issue, nextState, { confirmAction: false });
  }

  function countSelectionTags(issues) {
    const counts = new Map();
    for (const issue of issues) {
      for (const label of issue.labels || []) {
        const key = label.name.toLocaleLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return counts;
  }

  function buildSelectionTagOptions(labels, counts, search) {
    const term = search.trim().replace(/^#+/, '').toLocaleLowerCase();
    return labels
      .map((label) => ({ name: label.name, count: counts.get(label.name.toLocaleLowerCase()) || 0 }))
      .filter((option) => option.name.toLocaleLowerCase().includes(term))
      // 선택에 이미 붙은 태그를 위로 올려, 떼는 조작을 먼저 만나게 한다.
      .sort((a, b) => (b.count > 0) - (a.count > 0) || a.name.localeCompare(b.name, $activeLocale));
  }

  function autofocus(node) {
    requestAnimationFrame(() => node.focus());
  }

  function closeSelectionTagPanel() {
    selectionTagPanelOpen = false;
    selectionTagSearch = '';
  }

  function toggleSelectionTagPanel() {
    if (selectionTagPanelOpen) closeSelectionTagPanel();
    else selectionTagPanelOpen = true;
  }

  function toggleSelectionTag(name) {
    const applied = selectionTagCounts.get(name.toLocaleLowerCase()) || 0;
    // 선택한 노트 전부에 붙어 있을 때만 떼고, 일부만 붙어 있으면 나머지에 마저 붙인다.
    applySelectionTag(name, applied > 0 && applied === selectedIssues.length ? 'remove' : 'add');
  }

  async function applySelectionTag(name, mode) {
    // 새 태그 이름만 정규화 대상이라, 공백이 들어간 기존 라벨 이름은 그대로 쓴다.
    const tagName = String(name || '').trim();
    if (!tagName || selectionTagBusy) return;
    const targets = selectedIssues.filter(
      (issue) => Boolean(hasIssueLabel(issue, tagName)) === (mode === 'remove')
    );
    if (!targets.length) return;

    error = '';
    selectionTagBusy = true;
    const refreshed = {};
    try {
      if (mode === 'add' && !repositoryLabels.some((label) => label.name.toLocaleLowerCase() === tagName.toLocaleLowerCase())) {
        mergeRepositoryLabels([await createLabel(token, repo, tagName)]);
      }
      // 노트마다 순차로 요청해 GitHub의 연속 쓰기 제한을 피하고, 끝난 것부터 목록에 반영한다.
      for (const issue of targets) {
        const currentNames = (issue.labels || []).map((label) => label.name);
        const nextNames = mode === 'add'
          ? [...currentNames, tagName]
          : currentNames.filter((label) => label.toLocaleLowerCase() !== tagName.toLocaleLowerCase());
        const saved = await setIssueLabels(token, repo, issue.number, nextNames);
        const savedLabels = saved.labels || [];
        refreshed[issue.number] = ++issueRefreshSequence;
        issues = issues.map((item) => item.id === issue.id ? { ...item, labels: savedLabels } : item);
        if (selectedIssue?.id === issue.id) selectedIssue = { ...selectedIssue, labels: savedLabels };
      }
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      selectionTagBusy = false;
      // 열려 있는 편집기는 선택이 풀린 뒤 GitHub에서 다시 읽어 태그를 맞춘다.
      if (Object.keys(refreshed).length) issueRefreshRequests = { ...issueRefreshRequests, ...refreshed };
      if (mode === 'remove' && activeLabel.toLocaleLowerCase() === tagName.toLocaleLowerCase()) loadIssues(true);
    }
  }

  function noteRefreshStateChanged(issueNumber, active) {
    if (active) refreshingIssueNumber = issueNumber;
    else if (refreshingIssueNumber === issueNumber) refreshingIssueNumber = null;
  }

  function noteSaved(savedIssue, localDraft = null) {
    const displayedIssue = localDraft ? { ...savedIssue, ...localDraft } : savedIssue;
    issues = issues.map((issue) => issue.id === savedIssue.id ? displayedIssue : issue);
    if (pinnedIssueIds.has(savedIssue.id)) {
      pinnedIssues = replacePinnedNoteSnapshot(pinnedIssues, displayedIssue);
      savePinnedNotes(activeWorkspaceId, pinnedIssues);
    }
    const savedIssueIsActive = contentRoute?.screen === 'note'
      && Number(contentRoute.value) === savedIssue.number;
    if (savedIssueIsActive) selectedIssue = displayedIssue;
    if (savedIssueIsActive && activeLabel && !hasIssueLabel(displayedIssue, activeLabel)) {
      router.navigate(`/note.${savedIssue.number}`);
    }
  }

  function noteRefreshed(refreshedIssue) {
    issues = issues.map((issue) => issue.id === refreshedIssue.id ? refreshedIssue : issue);
    if (pinnedIssueIds.has(refreshedIssue.id)) {
      pinnedIssues = replacePinnedNoteSnapshot(pinnedIssues, refreshedIssue);
      savePinnedNotes(activeWorkspaceId, pinnedIssues);
    }
    const refreshedIssueIsActive = contentRoute?.screen === 'note'
      && Number(contentRoute.value) === refreshedIssue.number;
    if (refreshedIssueIsActive) selectedIssue = refreshedIssue;
  }

  function togglePin(issue) {
    if (!issue || issue.local) return;
    pinnedIssues = togglePinnedNote(pinnedIssues, issue);
    savePinnedNotes(activeWorkspaceId, pinnedIssues);
  }

  function noteCreated(savedIssue) {
    // 번호 할당 시점에 이미 주소를 note.{번호}로 바꿔두므로, 저장이 끝날 때쯤엔
    // contentRoute.screen이 'new'가 아니라 'note'일 수 있다.
    const newNoteIsActive = isPendingNoteRoute(contentRoute);
    error = '';
    query = activeLabel ? `#${activeLabel}` : '';
    appliedQuery = query;
    state = 'open';
    issues = [savedIssue, ...issues.filter((issue) => issue.id !== savedIssue.id)];
    totalIssues = Math.max(totalIssues, (pendingNote?.countBaseline ?? totalIssues) + 1);
    pendingNote = null;
    pendingAllocation = null;
    if (newNoteIsActive) selectedIssue = savedIssue;
    if (newNoteIsActive) {
      // note.{번호}로 리마운트되는 그 인스턴스에서만 한 번 포커스를 넣도록,
      // 렌더가 반영된 직후 바로 지운다(이후 그 번호를 다시 열 때 엉뚱하게
      // 자동 포커스되지 않게).
      justPromotedNumber = savedIssue.number;
      tick().then(() => {
        if (justPromotedNumber === savedIssue.number) justPromotedNumber = null;
      });
    }
    if (newNoteIsActive && activeLabel && !hasIssueLabel(savedIssue, activeLabel)) {
      router.navigate(`/note.${savedIssue.number}`);
    } else {
      const nextStack = routeStack.map((route) => route.screen === 'new'
        ? `note.${savedIssue.number}`
        : route.segment);
      router.navigate(`/${nextStack.join('/')}`);
    }
  }

  function hasIssueLabel(issue, labelName) {
    return issue?.labels?.some(
      (label) => label.name.toLocaleLowerCase() === labelName.toLocaleLowerCase()
    );
  }

  function noteDraftChanged(sourceIssue, draft) {
    if (!sourceIssue) {
      if (!pendingNote) return;
      pendingNote = { ...pendingNote, ...draft };
      if (isPendingNoteRoute(contentRoute)) selectedIssue = pendingNote;
      return;
    }

    issues = issues.map((issue) => issue.id === sourceIssue.id ? { ...issue, ...draft } : issue);
    if (selectedIssue?.id === sourceIssue.id) selectedIssue = { ...selectedIssue, ...draft };
  }

  function mergeRepositoryLabels(nextLabels) {
    const labelsByName = new Map(
      [...repositoryLabels, ...nextLabels].map((label) => [label.name.toLocaleLowerCase(), label])
    );
    repositoryLabels = [...labelsByName.values()].sort((a, b) => a.name.localeCompare(b.name, $activeLocale));
  }

  function replaceLabelInIssue(issue, currentName, nextName = '') {
    if (!issue) return issue;
    const nextLabels = (issue.labels || [])
      .filter((label) => nextName || label.name.toLocaleLowerCase() !== currentName.toLocaleLowerCase())
      .map((label) => label.name.toLocaleLowerCase() === currentName.toLocaleLowerCase()
        ? { ...label, name: nextName }
        : label);
    return { ...issue, labels: nextLabels };
  }

  function updateDraftLabels(repoName, currentName, nextName = '') {
    const draftsKey = 'issue-note.drafts.v1';
    try {
      const store = JSON.parse(localStorage.getItem(draftsKey) || '{}');
      const repoDrafts = store[repoName];
      if (!repoDrafts) return;
      for (const draft of Object.values(repoDrafts)) {
        if (!Array.isArray(draft.labels)) continue;
        draft.labels = draft.labels
          .filter((name) => nextName || name.toLocaleLowerCase() !== currentName.toLocaleLowerCase())
          .map((name) => name.toLocaleLowerCase() === currentName.toLocaleLowerCase() ? nextName : name);
      }
      localStorage.setItem(draftsKey, JSON.stringify(store));
    } catch {
      // 손상된 초안 저장소는 편집기가 자체적으로 무시한다.
    }
  }

  function rewriteActiveTagRoute(nextName = '') {
    const nextSegments = routeStack
      .filter((route) => route.screen !== 'settings')
      .filter((route) => nextName || route.screen !== 'tag')
      .map((route) => route.screen === 'tag'
        ? `tag.${encodeURIComponent(nextName)}`
        : route.segment);
    settingsRouteOverride = nextSegments.join('/');
    router.navigate(`/${[...nextSegments, 'settings'].join('/')}`);
  }

  async function renameRepositoryLabel(label, nextName) {
    if (labelBusy) return false;
    const normalizedName = Array.from(nextName.trim()).slice(0, 50).join('');
    if (!normalizedName) {
      error = $_('dynamic.tagNameRequired', { values: { name: label.name } });
      return false;
    }
    if (normalizedName === label.name) return true;
    labelBusy = label.name;
    error = '';
    try {
      const connectedRepo = repository?.full_name || repo;
      const savedLabel = await renameLabel(token, connectedRepo, label.name, normalizedName);
      repositoryLabels = repositoryLabels
        .map((item) => item.name === label.name ? savedLabel : item)
        .sort((a, b) => a.name.localeCompare(b.name, $activeLocale));
      issues = issues.map((issue) => replaceLabelInIssue(issue, label.name, savedLabel.name));
      pendingNote = replaceLabelInIssue(pendingNote, label.name, savedLabel.name);
      selectedIssue = replaceLabelInIssue(selectedIssue, label.name, savedLabel.name);
      updateDraftLabels(connectedRepo, label.name, savedLabel.name);
      labelMutation = { id: ++labelMutationSequence, from: label.name, to: savedLabel.name };
      notice = $_('dynamic.tagRenamed', { values: { from: label.name, to: savedLabel.name } });
      if (activeLabel.toLocaleLowerCase() === label.name.toLocaleLowerCase()) {
        rewriteActiveTagRoute(savedLabel.name);
      }
      return true;
    } catch (reason) {
      error = friendlyError(reason);
      return false;
    } finally {
      labelBusy = '';
    }
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    const sequence = ++toastSequence;
    toastMessage = message;
    toastTimer = setTimeout(() => {
      if (sequence !== toastSequence) return;
      toastMessage = '';
    }, 2400);
  }

  // 환경설정은 화면을 벗어날 때(닫기·뒤로) 한 번에 확정한다.
  function applySettingsChanges() {
    if (appState !== 'ready') return;
    editorFontSize = Math.round(clampNumber(editorFontSize, 12, 32, 17));
    editorLineHeight = clampNumber(editorLineHeight, 1.2, 2.5, 1.8);
    editorMaxWidth = Math.round(clampNumber(editorMaxWidth, 480, 1600, 840));
    autoSaveSeconds = Math.round(clampNumber(autoSaveSeconds, 3, 30, 5));
    issuePageSize = Math.round(clampNumber(issuePageSize, 10, 100, 30));
    backgroundRefreshMinutes = normalizeBackgroundRefreshMinutes(backgroundRefreshMinutes);
    lockSessionMinutes = normalizeLockSessionMinutes(lockSessionMinutes);
    workspaceCacheMinutes = normalizeWorkspaceCacheMinutes(workspaceCacheMinutes);
    // 그냥 들여다보기만 하고 나온 경우에는 저장도 알림도 하지 않는다.
    if (preferenceSignature(currentPreferences()) === settingsEntrySignature) return;
    persistSettings(repo);
    restartBackgroundRefreshTimer();
    // 유지 시간을 바꾸면 이미 열려 있는 잠금 세션도 새 길이로 다시 센다.
    if (lockPin) setLockSession(lockPin);
    // 페이지 크기는 목록 요청에 그대로 들어가므로, 바뀌었으면 다시 불러온다.
    if (issuePageSize !== settingsEntryPageSize) loadIssues();
    settingsEntryPageSize = issuePageSize;
    settingsEntrySignature = preferenceSignature(currentPreferences());
  }

  function announceDeferredApply() {
    showToast($_("m.be71371eed"));
  }

  async function loadLocalFonts() {
    if (localFontLoadState === 'loading') return;
    if (typeof window.queryLocalFonts !== 'function') {
      localFontLoadState = 'unsupported';
      return;
    }

    localFontLoadState = 'loading';
    try {
      const faces = await window.queryLocalFonts();
      localFontFamilies = [...new Set(
        faces.map((face) => String(face.family || '').trim()).filter(Boolean)
      )].sort((left, right) => left.localeCompare(right));
      localFontLoadState = 'ready';
    } catch {
      // 권한 거부와 보안 컨텍스트 오류 모두 사용자가 다시 시도할 수 있게 처리한다.
      localFontLoadState = 'unavailable';
    }
  }

  $: selectedLocalFont = localFontFamily(editorFont);
  $: visibleLocalFontFamilies = [...new Set([
    ...localFontFamilies,
    ...(selectedLocalFont ? [selectedLocalFont] : [])
  ])].sort((left, right) => left.localeCompare(right));

  async function createRepositoryLabel(name) {
    if (labelBusy) return;
    const normalizedName = Array.from(name.trim()).slice(0, 50).join('');
    if (!normalizedName) return;
    labelBusy = normalizedName;
    error = '';
    try {
      const connectedRepo = repository?.full_name || repo;
      const savedLabel = await createLabel(token, connectedRepo, normalizedName);
      mergeRepositoryLabels([savedLabel]);
      notice = $_('dynamic.tagAdded', { values: { name: savedLabel.name } });
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      labelBusy = '';
    }
  }

  async function deleteRepositoryLabel(label) {
    if (labelBusy) return;
    if (!confirm($_('dynamic.deleteTagConfirm', { values: { name: label.name } }))) return;
    labelBusy = label.name;
    error = '';
    try {
      const connectedRepo = repository?.full_name || repo;
      await removeLabel(token, connectedRepo, label.name);
      repositoryLabels = repositoryLabels.filter((item) => item.name !== label.name);
      issues = issues.map((issue) => replaceLabelInIssue(issue, label.name));
      pendingNote = replaceLabelInIssue(pendingNote, label.name);
      selectedIssue = replaceLabelInIssue(selectedIssue, label.name);
      updateDraftLabels(connectedRepo, label.name);
      labelMutation = { id: ++labelMutationSequence, from: label.name, to: '' };
      notice = $_('dynamic.tagDeleted', { values: { name: label.name } });
      if (activeLabel.toLocaleLowerCase() === label.name.toLocaleLowerCase()) rewriteActiveTagRoute();
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      labelBusy = '';
    }
  }

  function openLabel(labelName) {
    query = `#${labelName}`;
    appliedQuery = query;
    selectedIssue = null;
    const route = `tag.${encodeURIComponent(labelName)}`;
    if (routeStack.some((item) => item.screen === 'tag')) router.navigate(route);
    else if (['note', 'new'].includes(topRoute?.screen)) router.navigate(`/${route}`);
    else router.push(route);
  }

  function clearLabel() {
    if (topRoute?.screen === 'tag') router.pop();
    else router.navigate('/');
  }

  function moveIssue(issue, nextState, { confirmAction = true } = {}) {
    if (
      confirmAction
      && nextState === 'open'
      && !confirm($_('dynamic.restoreConfirm', { values: { title: issue.title } }))
    ) return;

    error = '';
    const removedIndex = issues.findIndex((item) => item.id === issue.id);
    const wasSelected = selectedIssue?.id === issue.id;

    // 휴지통 이동/복원은 목록에서 즉시 반영하고, GitHub 요청은 뒤에서 처리한다.
    issues = issues.filter((item) => item.id !== issue.id);
    totalIssues = Math.max(0, totalIssues - 1);
    if (wasSelected) {
      selectedIssue = null;
      if (router.getDepth()) router.popTo(0);
    }

    void setIssueState(token, repo, issue.number, nextState)
      .then(() => {
        notice = nextState === 'closed'
          ? ''
          : $_("m.a480a954e7");
      })
      .catch((reason) => {
        if (!issues.some((item) => item.id === issue.id)) {
          const insertionIndex = removedIndex < 0 ? issues.length : Math.min(removedIndex, issues.length);
          issues = [...issues.slice(0, insertionIndex), issue, ...issues.slice(insertionIndex)];
          totalIssues += 1;
        }
        error = friendlyError(reason);
      });
  }

  function openSettings() {
    clearIssueSelection();
    settingsRouteOverride = '';
    settingsEntryPageSize = issuePageSize;
    settingsEntrySignature = preferenceSignature(currentPreferences());
    error = '';
    notice = '';
    router.push('settings');
  }

  function closeSettings() {
    router.pop();
  }

  let helpTopic = null;

  function openHelp(topic) {
    helpTopic = topic;
  }

  function closeHelp() {
    helpTopic = null;
  }

  async function copyMcpText(value, successMessage) {
    try {
      await navigator.clipboard.writeText(value);
      showToast(successMessage);
    } catch {
      showToast($_("m.da21b2386d"));
    }
  }

</script>

{#if (appState === 'booting' || appState === 'restoring') && topRoute?.screen !== 'settings'}
  <main class="boot-screen">
    <img class="brand-mark brand-mark-sm" src="./icon.svg" alt="" />
    <span class="text-secondary small">
      {appState === 'restoring' ? $_("m.dc21c1787a") : $_("m.e5f58095ac")}
    </span>
  </main>
{:else}
  {#if appState === 'setup' || appState === 'connecting'}
    <SetupWizard
      bind:repo
      bind:tokenInputValue
      bind:rememberToken
      busy={appState === 'connecting'}
      {error}
      {patCreationUrl}
      onConnect={() => connect(true)}
    />
  {/if}
  {#if topRoute?.screen === 'settings'}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <main
    class="setup-shell settings-overlay container py-4 py-md-5"
    on:click={(event) => { if (event.target === event.currentTarget) closeSettings(); }}
  >
    <section class="setup-card card border-0 shadow-sm mx-auto overflow-hidden">
      <div class="row g-0">
        <div class="col-12 bg-white p-4 p-md-5">
          <div class="d-flex align-items-start justify-content-between gap-3 mb-4">
            <div>
              <h2 class="h4 fw-bold mb-2">{$_("m.c7f73bb54d")}</h2>
            </div>
            <button
              class="btn btn-sm btn-outline-secondary flex-shrink-0"
              aria-label={$_("m.6bf9c432ba")}
              title={$_("m.6bf9c432ba")}
              on:click={closeSettings}
            ><i class="bi bi-x-lg" aria-hidden="true"></i></button>
          </div>

          {#if error}
            <div class="alert alert-danger" role="alert">{error}</div>
          {/if}
          {#if notice}
            <div class="alert alert-success" role="status">{notice}</div>
          {/if}

          <div>
            {#if workspaces.length}
              <div class="workspace-section mb-4">
                <h3 class="workspace-section-title">{$_('workspace.settingsSectionTitle')}</h3>
                <p class="form-text mt-0">{$_('workspace.settingsSectionHelp')}</p>
                <WorkspaceList
                  {workspaces}
                  {activeWorkspaceId}
                  onMove={moveWorkspace}
                  onLeave={leaveWorkspace}
                  onSwitch={switchWorkspace}
                  onRename={renameWorkspace}
                  onAddWorkspace={openAddWorkspaceWizard}
                  tagLabels={repositoryLabels}
                  tagBusy={labelBusy}
                  onCreateTag={createRepositoryLabel}
                  onRenameTag={renameRepositoryLabel}
                  onDeleteTag={deleteRepositoryLabel}
                />
              </div>
            {/if}

            <fieldset class="editor-settings mb-4">
              <legend>{$_("m.cf8e8136d8")}</legend>
              <div class="mb-3">
                <label class="form-label" for="language">{$_('settings.language')}</label>
                <select
                  id="language"
                  class="form-select"
                  bind:value={languagePreference}
                  on:change={() => setAppLocale(languagePreference)}
                >
                  {#each LOCALE_OPTIONS as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label" for="title-mode">{$_("m.871b7ed110")}</label>
                <select id="title-mode" class="form-select" bind:value={titleMode} on:change={announceDeferredApply}>
                  <option value="first-line">{$_("m.7358ee0f0a")}</option>
                  <option value="separate">{$_("m.4a13beb6d6")}</option>
                </select>
              </div>
              <div class="mb-3">
                <span class="form-label d-block">{$_("m.62c6f9ddb9")}</span>
                <div class="form-check form-check-inline">
                  <input class="form-check-input" type="checkbox" id="list-field-title" bind:checked={listRowFields.title} on:change={announceDeferredApply} />
                  <label class="form-check-label" for="list-field-title">{$_("m.768e0c1c69")}</label>
                </div>
                <div class="form-check form-check-inline">
                  <input class="form-check-input" type="checkbox" id="list-field-summary" bind:checked={listRowFields.summary} on:change={announceDeferredApply} />
                  <label class="form-check-label" for="list-field-summary">{$_("m.12b71c3e0f")}</label>
                </div>
                <div class="form-check form-check-inline">
                  <input class="form-check-input" type="checkbox" id="list-field-meta" bind:checked={listRowFields.meta} on:change={announceDeferredApply} />
                  <label class="form-check-label" for="list-field-meta">{$_("m.e2a9becb94")}</label>
                </div>
                <div class="form-check form-check-inline">
                  <input class="form-check-input" type="checkbox" id="list-field-tags" bind:checked={listRowFields.tags} on:change={announceDeferredApply} />
                  <label class="form-check-label" for="list-field-tags">{$_("m.848eed0fbd")}</label>
                </div>
              </div>
              <div class="row g-2">
                <div class="col-sm-6">
                  <label class="form-label" for="editor-font">{$_("m.b97c4d4cdd")}</label>
                  <select
                    id="editor-font"
                    class="form-select"
                    bind:value={editorFont}
                    on:focus={loadLocalFonts}
                    on:change={announceDeferredApply}
                  >
                    <option value="system">{$_("m.9d8d380806")}</option>
                    <option value="sans">{$_("m.ecc39dc539")}</option>
                    <option value="serif">{$_("m.a5c78a86fa")}</option>
                    <option value="mono">{$_("m.216fcddff2")}</option>
                    {#each visibleLocalFontFamilies as family}
                      <option value={localFontValue(family)}>{family}</option>
                    {/each}
                  </select>
                </div>
                <div class="col-6 col-sm-3">
                  <label class="form-label" for="font-size">{$_("m.b7152342a2")}</label>
                  <input id="font-size" class="form-control" type="number" min="12" max="32" step="1" bind:value={editorFontSize} on:change={announceDeferredApply} />
                </div>
                <div class="col-6 col-sm-3">
                  <label class="form-label" for="line-height">{$_("m.65be5133e7")}</label>
                  <input id="line-height" class="form-control" type="number" min="1.2" max="2.5" step="0.1" bind:value={editorLineHeight} on:change={announceDeferredApply} />
                </div>
              </div>
              <div class="row g-2 mt-1">
                <div class="col-6">
                  <label class="form-label" for="auto-save-seconds">{$_("m.41380d4108")}</label>
                  <div class="input-group">
                    <input id="auto-save-seconds" class="form-control" type="number" min="3" max="30" step="1" bind:value={autoSaveSeconds} on:change={announceDeferredApply} />
                    <span class="input-group-text">{$_("m.920a25ef68")}</span>
                  </div>
                </div>
                <div class="col-6">
                  <label class="form-label" for="issue-page-size">{$_("m.31ec42c218")}</label>
                  <input id="issue-page-size" class="form-control" type="number" min="10" max="100" step="1" bind:value={issuePageSize} on:change={announceDeferredApply} />
                </div>
              </div>
              <div class="row g-2 mt-1">
                <div class="col-6">
                  <label class="form-label" for="editor-max-width">{$_('settings.editorMaxWidth')}</label>
                  <div class="input-group">
                    <input id="editor-max-width" class="form-control" type="number" min="480" max="1600" step="10" bind:value={editorMaxWidth} on:change={announceDeferredApply} />
                    <span class="input-group-text">px</span>
                  </div>
                </div>
              </div>
              <div class="mt-3">
                <label class="form-label" for="background-refresh-minutes">{$_('settings.backgroundRefreshInterval')}</label>
                <select
                  id="background-refresh-minutes"
                  class="form-select"
                  bind:value={backgroundRefreshMinutes}
                  on:change={announceDeferredApply}
                >
                  {#each BACKGROUND_REFRESH_OPTIONS as minutes}
                    <option value={minutes}>
                      {minutes === 0 ? $_('settings.refreshDisabled') : `${minutes} ${$_('settings.minutes')}`}
                    </option>
                  {/each}
                </select>
              </div>
              <div class="mt-3">
                <label class="form-label" for="workspace-cache-minutes">{$_('settings.workspaceCacheDuration')}</label>
                <select
                  id="workspace-cache-minutes"
                  class="form-select"
                  bind:value={workspaceCacheMinutes}
                  on:change={announceDeferredApply}
                >
                  {#each WORKSPACE_CACHE_OPTIONS as minutes}
                    <option value={minutes}>
                      {minutes % 60 === 0
                        ? `${minutes / 60} ${$_('settings.hours')}`
                        : `${minutes} ${$_('settings.minutes')}`}
                    </option>
                  {/each}
                </select>
                <div class="settings-help-note">※ {$_('settings.workspaceCacheHelp')}</div>
              </div>
              <div class="mt-3">
                <label class="form-label" for="lock-session-minutes">{$_('settings.lockSessionDuration')}</label>
                <select
                  id="lock-session-minutes"
                  class="form-select"
                  bind:value={lockSessionMinutes}
                  on:change={announceDeferredApply}
                >
                  {#each LOCK_SESSION_OPTIONS as minutes}
                    <option value={minutes}>
                      {minutes % 60 === 0
                        ? `${minutes / 60} ${$_('settings.hours')}`
                        : `${minutes} ${$_('settings.minutes')}`}
                    </option>
                  {/each}
                </select>
                <div class="settings-help-note">※ {$_('settings.lockSessionHelp')}</div>
              </div>
              </fieldset>

          </div>
        </div>
      </div>
    </section>
  </main>
  {/if}
  {#if appState === 'ready' || topRoute?.screen === 'settings'}
  <div
    class="app-shell"
    class:mobile-detail-active={Boolean(contentRoute)}
    class:touch-device={touchDevice}
  >
    {#if toastMessage}
      <div class="app-toast" role="status">{toastMessage}</div>
    {/if}
    <main class="note-workspace" class:sidebar-resizing={sidebarResizing} style="--sidebar-width: {sidebarWidth}px">
      <aside class="note-sidebar">
        <div
          class="sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="사이드바 너비 조절"
          on:pointerdown={startSidebarResize}
        ></div>
        <div class="sidebar-heading">
          <div class="sidebar-heading-main" class:is-hidden={selectionMode}>
            <WorkspaceSwitcher
              {workspaces}
              {activeWorkspaceId}
              {user}
              busy={appState === 'connecting' || appState === 'restoring'}
              onSwitch={switchWorkspace}
            />
            <div class="sidebar-heading-title">
              <h1>{state === 'open' ? $_("m.70440046a3") : $_("m.e3bf62bb7f")}</h1>
              <span>{$_('dynamic.noteCount', { values: { count: displayedIssueCount } })}</span>
            </div>
          </div>
          <button
            class="btn btn-outline-secondary responsive-toolbar-button sidebar-settings-button"
            class:is-hidden={selectionMode}
            on:click={openSettings}
          >
            <i class="bi bi-gear" aria-hidden="true"></i> {$_('settings.sidebarLabel')}
          </button>
          <div class="sidebar-selection-toolbar" class:active={selectionMode} aria-hidden={!selectionMode}>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              class:active={selectionTagPanelOpen}
              aria-expanded={selectionTagPanelOpen}
              on:click={toggleSelectionTagPanel}
              tabindex={selectionMode ? 0 : -1}
            >
              <i class="bi bi-tags" aria-hidden="true"></i> {$_("m.848eed0fbd")}
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline-danger"
              disabled={selectionTagBusy}
              on:click={moveSelectedIssues}
              tabindex={selectionMode ? 0 : -1}
            >
              <i class={`bi ${state === 'open' ? 'bi-trash3' : 'bi-arrow-counterclockwise'}`} aria-hidden="true"></i>
              {state === 'open' ? $_("m.f6fdbe48dc") : $_("m.3cbe6d6b9a")}
            </button>
            <button type="button" class="btn btn-sm btn-outline-secondary" on:click={clearIssueSelection} tabindex={selectionMode ? 0 : -1}>
              {$_("m.bbfa773e5a")}
            </button>
          </div>
        </div>

        {#if selectionMode && selectionTagPanelOpen}
          <div class="sidebar-selection-tags" class:is-busy={selectionTagBusy}>
            <div class="selection-tag-search">
              <input
                bind:value={selectionTagSearch}
                placeholder={$_("m.eb7b580e41")}
                aria-label={$_("m.eb7b580e41")}
                maxlength="51"
                use:autofocus
              />
              {#if selectionTagBusy}
                <span class="spinner-border spinner-border-sm region-spinner" aria-hidden="true"></span>
              {/if}
            </div>
            <div class="selection-tag-list" aria-label={$_("m.9e704d11d1")}>
              {#each selectionTagOptions as option (option.name)}
                {@const appliedToAll = option.count > 0 && option.count === selectedIssues.length}
                <button
                  type="button"
                  disabled={selectionTagBusy}
                  on:click={() => toggleSelectionTag(option.name)}
                >
                  <span class="label-dot" style={`--label-color:#${tagColorForName(option.name)}`}></span>
                  <span class="selection-tag-name">#{option.name}</span>
                  {#if option.count}
                    <span class="selection-tag-count">{option.count}/{selectedIssues.length}</span>
                  {/if}
                  <i class={`bi ${appliedToAll ? 'bi-dash-lg' : 'bi-plus-lg'}`} aria-hidden="true"></i>
                </button>
              {/each}
              {#if canCreateSelectionTag}
                <button
                  type="button"
                  class="create-tag"
                  disabled={selectionTagBusy}
                  on:click={() => applySelectionTag(selectionNewTagName, 'add')}
                >
                  <span class="label-dot" style={`--label-color:#${tagColorForName(selectionNewTagName)}`}></span>
                  {$_('dynamic.createTag', { values: { name: selectionNewTagName } })}
                </button>
              {:else if !selectionTagOptions.length}
                <span class="tag-dropdown-empty">{$_("m.2240ffb750")}</span>
              {/if}
            </div>
          </div>
        {/if}

        {#if error}
          <div class="sidebar-message text-danger">{error}</div>
        {/if}

        <div class="note-list" class:is-loading={loading}>
          <div class="note-list-scroll" bind:this={sidebarScrollElement} on:scroll={handleSidebarScroll}>
            <div
              class="sidebar-tools"
              class:is-revealing={sidebarToolsRevealing}
              bind:this={sidebarToolsElement}
              style={`--sidebar-tools-offset:${sidebarToolsOffset}px`}
            >
              <div class="state-tabs" role="group" aria-label={$_("m.cd9fe96e05")}>
                <button class="btn btn-sm" class:active={state === 'open'} on:click={() => changeState('open')} disabled={selectionMode}>
                  <i class="bi bi-journal-text" aria-hidden="true"></i> {$_("m.70440046a3")}
                </button>
                <button class="btn btn-sm" class:active={state === 'closed'} on:click={() => changeState('closed')} disabled={selectionMode}>
                  <i class="bi bi-trash3" aria-hidden="true"></i> {$_("m.e3bf62bb7f")}
                </button>
              </div>
              <div class="sidebar-search">
                <form class="input-group" on:submit|preventDefault={submitSearch}>
                  <input
                    class="form-control form-control-sm"
                    type="search"
                    role="combobox"
                    bind:value={query}
                    placeholder={$_("m.55a302a1a9")}
                    aria-label={$_("m.2bca6e4c82")}
                    aria-autocomplete="list"
                    aria-controls="sidebar-label-suggestions"
                    aria-expanded={sidebarSearchFocused && sidebarLabelSuggestions.length > 0}
                    on:focus={() => sidebarSearchFocused = true}
                    on:input={() => sidebarSuggestionIndex = -1}
                    on:keydown={handleSidebarSearchKeydown}
                    on:blur={() => sidebarSearchFocused = false}
                    disabled={selectionMode}
                  />
                  <button class="btn btn-sm" disabled={loading || selectionMode}><i class="bi bi-search" aria-hidden="true"></i> {$_("m.bce0641417")}</button>
                </form>
                {#if !selectionMode && sidebarSearchFocused && sidebarLabelSuggestions.length > 0}
                  <div class="sidebar-label-suggestions" id="sidebar-label-suggestions" role="listbox">
                    {#each sidebarLabelSuggestions as label, index (label.id || label.name)}
                      <button
                        type="button"
                        role="option"
                        aria-selected={sidebarSuggestionIndex === index}
                        class:active={sidebarSuggestionIndex === index}
                        on:mousedown|preventDefault
                        on:click={() => selectSidebarLabel(label)}
                      >#{label.name}</button>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
            <div class="note-list-body">
            <div class="sidebar-new-note">
              <button
                class="btn btn-primary btn-sm btn-block w-100"
                on:click={newNote}
                disabled={Boolean(pendingNote) || selectionMode}
              >
                <i class="bi bi-plus-lg" aria-hidden="true"></i> {$_("m.2b7b05c002")}
                <span class="sidebar-new-note-shortcut" aria-hidden="true">(N)</span>
              </button>
            </div>
            {#if pinnedIssues.length}
              <div class="note-list-pinned">
                {#each pinnedIssues as issue (issue.id)}
                  <NoteListRow
                    {issue}
                    pinned
                    selected={selectedIssue?.id === issue.id}
                    keyboardFocused={keyboardFocusedIssueId === String(issue.id)}
                    {selectionMode}
                    checked={selectedIssueIds.has(issue.id)}
                    archived={state === 'closed'}
                    {listRowFields}
                    refreshing={refreshingIssueNumber === issue.number}
                    onPointerDown={beginIssueLongPress}
                    onPointerMove={trackIssueLongPress}
                    onPointerUp={finishIssueLongPress}
                    onPointerCancel={finishIssueLongPress}
                    onContextMenu={handleIssueContextMenu}
                    onClick={handleIssueClick}
                    onSelectionClick={handleIssueSelectionClick}
                  />
                {/each}
              </div>
            {/if}
            {#if !loading && unpinnedVisibleIssues.length === 0 && pinnedIssues.length === 0}
              <div class="list-status">{emptyMessage}</div>
            {:else}
              {#each unpinnedVisibleIssues as issue (issue.id)}
                <NoteListRow
                  {issue}
                  selected={selectedIssue?.id === issue.id}
                  keyboardFocused={keyboardFocusedIssueId === String(issue.id)}
                  {selectionMode}
                  checked={selectedIssueIds.has(issue.id)}
                  archived={state === 'closed'}
                  {listRowFields}
                  refreshing={refreshingIssueNumber === issue.number}
                  onPointerDown={beginIssueLongPress}
                  onPointerMove={trackIssueLongPress}
                  onPointerUp={finishIssueLongPress}
                  onPointerCancel={finishIssueLongPress}
                  onContextMenu={handleIssueContextMenu}
                  onClick={handleIssueClick}
                  onSelectionClick={handleIssueSelectionClick}
                />
              {/each}
              {#if hasMoreIssues}
                <div class="list-load-more">
                  <button class="btn btn-sm btn-link text-secondary" disabled={loadingMore} on:click={loadMoreIssues}>
                    {#if loadingMore}
                      <span class="spinner-border spinner-border-sm region-spinner" aria-hidden="true"></span>
                    {:else}
                      <i class="bi bi-chevron-down" aria-hidden="true"></i>
                    {/if}
                    {$_("m.dfe60ca92e")}
                  </button>
                </div>
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
      </aside>

      <section class="note-detail">
        {#if contentRoutes.length}
          {#each contentRoutes as route (route.segment)}
            {@const routeIssue = issueForRoute(route)}
            {#if isPendingNoteRoute(route) || routeIssue}
            <div
              class="note-detail-layer"
              class:active={route === contentRoute}
              aria-hidden={route !== contentRoute}
            >
            <NoteEditor
              {token}
              {repo}
              issue={routeIssue}
              initialDraft={isPendingNoteRoute(route) ? pendingNote : null}
              ignoreRecoveredDraft={isPendingNoteRoute(route) && Boolean(pendingNote?.ignoreRecoveredDraft)}
              justCreated={Boolean(routeIssue) && routeIssue.number === justPromotedNumber}
              focusRequest={route === contentRoute ? editorFocusRequest : 0}
              externalPasteRequest={route === contentRoute ? externalPasteRequest : null}
              refreshRequest={routeIssue ? issueRefreshRequests[routeIssue.number] || 0 : 0}
              allocationPromise={isPendingNoteRoute(route) ? pendingAllocation : null}
              editorId={route.segment.replace(/[^a-zA-Z0-9_-]/g, '-')}
              archived={state === 'closed'}
              {titleMode}
              font={editorFont}
              fontSize={editorFontSize}
              lineHeight={editorLineHeight}
              maxWidth={editorMaxWidth}
              {autoSaveSeconds}
              {lockPin}
              {lockSessionMinutes}
              onSetLockSession={setLockSession}
              currentUserLogin={user?.login || ''}
              paused={topRoute?.screen === 'settings' || route !== contentRoute || selectionMode}
              readOnly={selectionMode}
              availableLabels={repositoryLabels}
              {labelMutation}
              pinned={Boolean(routeIssue) && pinnedIssueIds.has(routeIssue.id)}
              pinDisabled={pinnedIssues.length >= MAX_PINNED_NOTES}
              onTogglePin={() => togglePin(routeIssue)}
              onSaved={noteSaved}
              onRefreshed={noteRefreshed}
              onRefreshStateChange={(active) => noteRefreshStateChanged(routeIssue?.number, active)}
              onCreated={noteCreated}
              onDraftChange={(draft) => noteDraftChanged(routeIssue, draft)}
              onExternalPasteHandled={externalPasteHandled}
              onLabelsAvailable={mergeRepositoryLabels}
              onMove={(issue) => moveIssue(issue, state === 'open' ? 'closed' : 'open')}
              onBack={() => router.pop()}
            />
            </div>
            {/if}
          {/each}
        {:else}
          <div class="detail-empty detail-empty-guide">
            <p>{$_("m.15147e26a7")}</p>
            <div class="help-links">
              <button type="button" class="help-link" on:click={() => openHelp('security')}>{$_('help.buttonSecurity')}</button>
              <span class="help-sep" aria-hidden="true">|</span>
              <button type="button" class="help-link" on:click={() => openHelp('mcp')}>{$_('help.buttonMcp')}</button>
              <span class="help-sep" aria-hidden="true">|</span>
              <button type="button" class="help-link" on:click={() => openHelp('app')}>{$_('help.buttonApp')}</button>
            </div>
          </div>
        {/if}
      </section>
    </main>
  </div>
  {/if}
{/if}

{#if workspaceWizardOpen}
  <div class="workspace-wizard-overlay">
    {#key workspaceWizardKey}
      <SetupWizard
        bind:repo={workspaceWizardRepo}
        bind:tokenInputValue={workspaceWizardToken}
        bind:rememberToken={workspaceWizardRememberToken}
        busy={workspaceWizardBusy}
        error={workspaceWizardError}
        patCreationUrl={makePatCreationUrl(workspaceWizardRepo)}
        initialStep={3}
        allowCancel
        onCancel={closeAddWorkspaceWizard}
        onConnect={submitAddWorkspace}
      />
    {/key}
  </div>
{/if}

{#if helpTopic}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main
  class="setup-shell help-overlay container py-4 py-md-5"
  on:click={(event) => { if (event.target === event.currentTarget) closeHelp(); }}
>
  <section class="setup-card card border-0 shadow-sm mx-auto overflow-hidden">
    <div class="row g-0">
      <div class="col-12 bg-white p-4 p-md-5">
        <div class="d-flex align-items-start justify-content-between gap-3 mb-4">
          <h2 class="h4 fw-bold mb-0">
            {#if helpTopic === 'security'}
              {$_('help.securityTitle')}
            {:else if helpTopic === 'mcp'}
              {$_('m.5fe5834eaa')}
            {:else}
              {$_('help.appTitle')}
            {/if}
          </h2>
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary flex-shrink-0"
            aria-label={$_("m.bbfa773e5a")}
            title={$_("m.bbfa773e5a")}
            on:click={closeHelp}
          ><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </div>
        {#if helpTopic === 'security'}
          <p class="small help-text">{$_('help.securityIntro')}</p>
          <div class="help-diagram">
            <div>{$_('help.securityDiagramFlow')}</div>
            <div class="help-diagram-note">{$_('help.securityDiagramNote')}</div>
          </div>
          <ul class="help-points small help-text">
            <li>{$_('help.securityPoint1')}</li>
            <li>{$_('help.securityPoint2')}</li>
            <li>{$_('help.securityPoint3')}</li>
            <li>{$_('help.securityPoint4')}</li>
            <li>{$_('help.securityPoint5')}</li>
          </ul>
          <p class="small help-text">{$_('help.securityOutro')}</p>
          <a
            class="btn btn-sm btn-outline-secondary"
            href="https://github.com/zidell/ginote#readme"
            target={newContextTarget}
            rel="noreferrer"
          ><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> {$_('help.securityLinkLabel')}</a>
        {:else if helpTopic === 'mcp'}
          <p class="small help-text">{$_('help.mcpIntro')}</p>
          <McpGuide {mcpRepository} {mcpUsagePrompt} onCopy={copyMcpText} {newContextTarget} />
        {:else}
          <p class="small help-text">{$_('help.appIntro')}</p>
          <h3 class="help-section-title">{$_('help.appPwaSectionTitle')}</h3>
          <ul class="help-points small help-text">
            <li>{$_('help.appPwaChromeDesktop')}</li>
            <li>{$_('help.appPwaAndroid')}</li>
            <li>{$_('help.appPwaIOS')}</li>
            <li>{$_('help.appPwaMacSafari')}</li>
          </ul>
          <p class="small help-text">{$_('help.appPwaNote')}</p>
          <h3 class="help-section-title">{$_('help.appDesktopSectionTitle')}</h3>
          <p class="small help-text">{$_('help.appDesktopIntro')}</p>
          <p class="small help-text mb-1">{$_('help.appDesktopHomebrew')}</p>
          <pre class="help-code">brew tap zidell/ginote https://github.com/zidell/ginote
brew install --cask ginote</pre>
          <a
            class="btn btn-sm btn-outline-secondary"
            href="https://github.com/zidell/ginote/releases"
            target={newContextTarget}
            rel="noreferrer"
          ><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> {$_('help.appDesktopLinkLabel')}</a>
        {/if}
      </div>
    </div>
  </section>
</main>
{/if}
