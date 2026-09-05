<script>
  import { onMount, tick } from 'svelte';
  import { createStackRouter } from 'spa-stack-router';
  import BrailleSpinner from './lib/BrailleSpinner.svelte';
  import { externalLinkTarget } from './lib/external-links.js';
  import NoteEditor from './lib/NoteEditor.svelte';
  import SetupWizard from './lib/SetupWizard.svelte';
  import TagSettings from './lib/TagSettings.svelte';
  import { tagColorForName } from './lib/colors.js';
  import { _, locale as activeLocale } from 'svelte-i18n';
  import { LOCALE_OPTIONS, setAppLocale } from './lib/i18n.js';
  import { firstLinePreview, markdownToPlainText, normalizeTagName } from './lib/notes.js';
  import { isLockedTitle } from './lib/note-lock.js';
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

  const STORAGE_KEY = 'issue-note.settings.v1';
  const ATTACHMENT_PRUNE_STORAGE_KEY = 'issue-note.attachment-prune.v1';
  const BACKGROUND_REFRESH_DEFAULT_MINUTES = 60;
  const BACKGROUND_REFRESH_OPTIONS = [0, 5, 15, 30, 60, 180];
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
  const ATTACHMENT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const LOCK_SESSION_DEFAULT_MINUTES = 60;
  const LOCK_SESSION_OPTIONS = [5, 15, 30, 60, 180, 480];
  const SIDEBAR_LOAD_MORE_THRESHOLD_PX = 160;
  const router = createStackRouter({ mode: 'hashbang', escToBack: true });
  const newContextTarget = externalLinkTarget();

  let token = '';
  let tokenInputValue = '';
  let repo = '';
  let rememberToken = true;
  let appState = 'booting';
  let user = null;
  let repository = null;
  let issues = [];
  let repositoryLabels = [];
  let selectedIssue = null;
  let pendingNote = null;
  let pendingAllocation = null;
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
  let toastMessage = '';
  let toastTimer;
  let toastSequence = 0;
  let routeStack = [];
  let titleMode = 'first-line';
  let editorFont = 'system';
  let editorFontSize = 16;
  let editorLineHeight = 1.7;
  let autoSaveSeconds = 5;
  let issuePageSize = 30;
  let backgroundRefreshMinutes = BACKGROUND_REFRESH_DEFAULT_MINUTES;
  let lockSessionMinutes = LOCK_SESSION_DEFAULT_MINUTES;
  let languagePreference = 'auto';
  let settingsSnapshot = null;
  let backgroundRefreshTimer;
  let labelBusy = '';
  let labelMutation = null;
  let labelMutationSequence = 0;
  let labelRenameDrafts = [];
  let settingsRouteOverride = '';
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
  $: guideRepository = repositoryName(repo);
  $: repositoryIssuesUrl = repository?.html_url
    ? `${repository.html_url.replace(/\/$/, '')}/issues`
    : guideRepository ? `https://github.com/${guideRepository.fullName}/issues` : '';
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
        if (settingsSnapshot) restoreSettingsSnapshot();
        if (appState === 'connecting') appState = 'ready';
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

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      repo = saved.repo || '';
      token = saved.token || '';
      // PAT가 아직 없는 첫 실행에도 기본값은 저장으로 둔다. 실제 저장 여부는
      // 연결 직전에 개인용 디바이스인지 한 번 더 확인한다.
      rememberToken = true;
      titleMode = saved.preferences?.titleMode || 'first-line';
      editorFont = saved.preferences?.editorFont || 'system';
      editorFontSize = Number(saved.preferences?.editorFontSize) || 16;
      editorLineHeight = Number(saved.preferences?.editorLineHeight) || 1.7;
      autoSaveSeconds = clampNumber(saved.preferences?.autoSaveSeconds, 3, 30, 5);
      issuePageSize = clampNumber(saved.preferences?.issuePageSize, 10, 100, 30);
      backgroundRefreshMinutes = normalizeBackgroundRefreshMinutes(saved.preferences?.backgroundRefreshMinutes);
      lockSessionMinutes = normalizeLockSessionMinutes(saved.preferences?.lockSessionMinutes);
      const savedLanguage = saved.preferences?.language || 'auto';
      languagePreference = LOCALE_OPTIONS.some((option) => option.value === savedLanguage) ? savedLanguage : 'auto';
      setAppLocale(languagePreference);
      if (token && repo) {
        connect(false, true);
      } else {
        appState = 'setup';
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      appState = 'setup';
    }

    restartBackgroundRefreshTimer();

    return () => {
      clearInterval(backgroundRefreshTimer);
      clearTimeout(lockSessionTimer);
      clearTimeout(longPressTimer);
      clearTimeout(suppressIssueClickTimer);
      clearTimeout(toastTimer);
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
    const issueNumber = Number(route?.value);

    if (route?.screen === 'note') {
      selectedIssue = issues.find((issue) => issue.number === issueNumber) || null;
      // 삭제됐거나 더는 현재 목록에 없는 이슈의 오래된 URL은 본문 레이어를
      // 비워 두지 않는다. 첫 목록 요청이 끝난 뒤 홈 목록으로 되돌린다.
      if (!selectedIssue && appState === 'ready' && !loading) router.navigate('/');
      return;
    }

    if (route?.screen === 'new') {
      selectedIssue = pendingNote;
      return;
    }

    selectedIssue = null;
  }

  function issueForRoute(route) {
    if (route.screen === 'new') return null;
    const issueNumber = Number(route.value);
    return issues.find((issue) => issue.number === issueNumber) || null;
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

  function persistSettings(normalizedRepo) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        repo: normalizedRepo,
        token: rememberToken ? token : '',
        preferences: {
          titleMode,
          editorFont,
          editorFontSize,
          editorLineHeight,
          autoSaveSeconds,
          issuePageSize,
          backgroundRefreshMinutes,
          lockSessionMinutes,
          language: languagePreference
        }
      })
    );
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function normalizeBackgroundRefreshMinutes(value) {
    const minutes = Number(value);
    return BACKGROUND_REFRESH_OPTIONS.includes(minutes) ? minutes : BACKGROUND_REFRESH_DEFAULT_MINUTES;
  }

  function normalizeLockSessionMinutes(value) {
    const minutes = Number(value);
    return LOCK_SESSION_OPTIONS.includes(minutes) ? minutes : LOCK_SESSION_DEFAULT_MINUTES;
  }

  function restartBackgroundRefreshTimer() {
    clearInterval(backgroundRefreshTimer);
    if (!backgroundRefreshMinutes) return;
    backgroundRefreshTimer = setInterval(() => {
      if (appState === 'ready' && topRoute?.screen !== 'settings') loadIssues(true);
    }, backgroundRefreshMinutes * 60 * 1000);
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

  function repositoryName(value) {
    const cleaned = value
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
    const parts = cleaned.split('/');
    return parts.length === 2 && parts.every(Boolean)
      ? { owner: parts[0], name: parts[1], fullName: cleaned }
      : null;
  }

  function normalizeToken(value) {
    return String(value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
  }

  function makePatCreationUrl(value) {
    const selected = repositoryName(value);
    const url = new URL('https://github.com/settings/personal-access-tokens/new');
    url.searchParams.set('name', `Ginote${selected ? ` - ${selected.name}` : ''}`.slice(0, 40));
    url.searchParams.set(
      'description',
      selected ? `Ginote access for ${selected.fullName}` : 'Ginote repository access'
    );
    url.searchParams.set('expires_in', 'none');
    url.searchParams.set('issues', 'write');
    url.searchParams.set('contents', 'write');
    if (selected) url.searchParams.set('target_name', selected.owner);
    return url.toString();
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

  function showToast(message) {
    clearTimeout(toastTimer);
    const sequence = ++toastSequence;
    toastMessage = message;
    toastTimer = setTimeout(() => {
      if (sequence !== toastSequence) return;
      toastMessage = '';
    }, 2400);
    return sequence;
  }

  function hideToast(sequence) {
    if (sequence !== toastSequence) return;
    clearTimeout(toastTimer);
    toastMessage = '';
  }

  async function copyMcpText(value, successMessage) {
    try {
      await navigator.clipboard.writeText(value);
      notice = successMessage;
      error = '';
    } catch {
      error = $_("m.da21b2386d");
    }
  }

  async function connect(showSuccess = true, restoring = false) {
    const fromSettings = routeStack.at(-1)?.screen === 'settings' && Boolean(settingsSnapshot);
    const isFirstConnection = !restoring && !fromSettings && appState === 'setup';
    if (isFirstConnection && rememberToken && !hasConfirmedPatStorage) {
      if (!confirm($_('setup.confirmPatStorage'))) return;
      hasConfirmedPatStorage = true;
    }
    const replacementToken = normalizeToken(tokenInputValue);
    const requestedToken = replacementToken || (fromSettings ? settingsSnapshot.token : token);
    const requestedRepo = repo;
    error = '';
    notice = '';
    appState = restoring ? 'restoring' : 'connecting';
    try {
      const result = await verifyConnection(requestedToken, requestedRepo);
      if (fromSettings && routeStack.at(-1)?.screen !== 'settings') return;
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
      if (fromSettings) {
        settingsSnapshot = null;
        router.pop();
      }
    } catch (reason) {
      if (fromSettings && routeStack.at(-1)?.screen !== 'settings') return;
      appState = fromSettings ? 'ready' : 'setup';
      error = friendlyError(reason);
    }
  }

  async function loadIssues(background = false) {
    if (background && loading) return;
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
      if (!background) error = friendlyError(reason);
    } finally {
      if (!background) loading = false;
    }
  }

  async function loadMoreIssues() {
    if (loading || loadingMore || !hasMoreIssues) return;
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
      loadingMore = false;
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
    try {
      repositoryLabels = await listLabels(token, repo);
    } catch (reason) {
      error = friendlyError(reason);
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
        id: 'local-new-note',
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
    if (event.key === 'Escape' && selectionMode) {
      event.preventDefault();
      clearIssueSelection();
      return;
    }
    if (
      appState !== 'ready'
      || topRoute?.screen === 'settings'
      || event.repeat
      || event.altKey
      || event.shiftKey
      || (!event.ctrlKey && !event.metaKey)
      || event.key.toLocaleLowerCase() !== 'n'
    ) return;
    event.preventDefault();
    newNote();
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
      if (pendingNote === localNote || pendingNote?.id === localNote.id) {
        pendingNote = {
          ...pendingNote,
          number: created.number,
          allocatedIssue: created,
          allocation: 'ready'
        };
        if (isNewRoute) selectedIssue = pendingNote;
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
    selectNote(issue);
  }

  function handleIssueLabelClick(event, issue, labelName) {
    if (suppressIssueClickId === issue.id) {
      event.preventDefault();
      suppressIssueClickId = null;
      clearTimeout(suppressIssueClickTimer);
      return;
    }
    if (selectionMode) {
      if (toggleIssueSelection(issue, event.shiftKey)) previewSelectedIssue(issue);
      return;
    }
    openLabel(labelName);
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
    const savedIssueIsActive = contentRoute?.screen === 'note'
      && Number(contentRoute.value) === savedIssue.number;
    if (savedIssueIsActive) selectedIssue = displayedIssue;
    if (savedIssueIsActive && activeLabel && !hasIssueLabel(displayedIssue, activeLabel)) {
      router.navigate(`/note.${savedIssue.number}`);
    }
  }

  function noteRefreshed(refreshedIssue) {
    issues = issues.map((issue) => issue.id === refreshedIssue.id ? refreshedIssue : issue);
    const refreshedIssueIsActive = contentRoute?.screen === 'note'
      && Number(contentRoute.value) === refreshedIssue.number;
    if (refreshedIssueIsActive) selectedIssue = refreshedIssue;
  }

  function noteCreated(savedIssue) {
    const newNoteIsActive = contentRoute?.screen === 'new';
    error = '';
    query = activeLabel ? `#${activeLabel}` : '';
    appliedQuery = query;
    state = 'open';
    issues = [savedIssue, ...issues.filter((issue) => issue.id !== savedIssue.id)];
    totalIssues = Math.max(totalIssues, (pendingNote?.countBaseline ?? totalIssues) + 1);
    pendingNote = null;
    pendingAllocation = null;
    if (newNoteIsActive) selectedIssue = savedIssue;
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
    return issue.labels?.some(
      (label) => label.name.toLocaleLowerCase() === labelName.toLocaleLowerCase()
    );
  }

  function labelColor(label) {
    return tagColorForName(label?.name);
  }

  function noteDraftChanged(sourceIssue, draft) {
    if (!sourceIssue) {
      if (!pendingNote) return;
      pendingNote = { ...pendingNote, ...draft };
      if (isNewRoute) selectedIssue = pendingNote;
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
    if (!normalizedName || normalizedName === label.name) return true;
    labelBusy = label.name;
    error = '';
    try {
      const connectedToken = settingsSnapshot?.token || token;
      const connectedRepo = repository?.full_name || settingsSnapshot?.repo || repo;
      const savedLabel = await renameLabel(connectedToken, connectedRepo, label.name, normalizedName);
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

  async function applyLabelRenameDrafts() {
    for (const draft of labelRenameDrafts) {
      const label = repositoryLabels.find((item) => item.id === draft.label.id);
      if (!label) continue;
      if (!draft.nextName) {
        error = $_('dynamic.tagNameRequired', { values: { name: label.name } });
        return false;
      }
      if (!await renameRepositoryLabel(label, draft.nextName)) return false;
    }
    labelRenameDrafts = [];
    return true;
  }

  function connectionSettingsChanged() {
    if (!settingsSnapshot) return true;
    const requestedRepo = repositoryName(repo)?.fullName || repo.trim();
    const savedRepo = repositoryName(settingsSnapshot.repo)?.fullName || settingsSnapshot.repo.trim();
    return Boolean(normalizeToken(tokenInputValue))
      || requestedRepo.toLocaleLowerCase() !== savedRepo.toLocaleLowerCase();
  }

  function finishLocalSettingsSave() {
    const pageSizeChanged = issuePageSize !== settingsSnapshot?.issuePageSize;
    tokenInputValue = '';
    repo = repository?.full_name || repositoryName(repo)?.fullName || repo.trim();
    autoSaveSeconds = clampNumber(autoSaveSeconds, 3, 30, 5);
    issuePageSize = Math.round(clampNumber(issuePageSize, 10, 100, 30));
    backgroundRefreshMinutes = normalizeBackgroundRefreshMinutes(backgroundRefreshMinutes);
    lockSessionMinutes = normalizeLockSessionMinutes(lockSessionMinutes);
    persistSettings(repo);
    restartBackgroundRefreshTimer();
    // 유지 시간을 바꾸면 이미 열려 있는 잠금 세션도 새 길이로 다시 센다.
    if (lockPin) setLockSession(lockPin);
    settingsSnapshot = null;
    labelRenameDrafts = [];
    appState = 'ready';
    notice = '';
    router.pop();
    if (pageSizeChanged) loadIssues();
  }

  async function saveConfiguration() {
    if (topRoute?.screen !== 'settings') {
      await connect(true);
      return;
    }

    error = '';
    notice = '';
    autoSaveSeconds = clampNumber(autoSaveSeconds, 3, 30, 5);
    issuePageSize = Math.round(clampNumber(issuePageSize, 10, 100, 30));
    backgroundRefreshMinutes = normalizeBackgroundRefreshMinutes(backgroundRefreshMinutes);
    lockSessionMinutes = normalizeLockSessionMinutes(lockSessionMinutes);
    const needsConnectionCheck = connectionSettingsChanged();
    if (!needsConnectionCheck && labelRenameDrafts.length === 0) {
      finishLocalSettingsSave();
      return;
    }

    appState = 'connecting';
    if (!await applyLabelRenameDrafts()) {
      appState = 'ready';
      return;
    }
    if (needsConnectionCheck) await connect(false);
    else finishLocalSettingsSave();
  }

  async function createRepositoryLabel(name) {
    if (labelBusy) return;
    const normalizedName = Array.from(name.trim()).slice(0, 50).join('');
    if (!normalizedName) return;
    labelBusy = normalizedName;
    error = '';
    try {
      const connectedToken = settingsSnapshot?.token || token;
      const connectedRepo = repository?.full_name || settingsSnapshot?.repo || repo;
      const savedLabel = await createLabel(connectedToken, connectedRepo, normalizedName);
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
    labelBusy = label.name;
    error = '';
    try {
      const connectedToken = settingsSnapshot?.token || token;
      const connectedRepo = repository?.full_name || settingsSnapshot?.repo || repo;
      await removeLabel(connectedToken, connectedRepo, label.name);
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
    const deletionToast = nextState === 'closed' ? showToast($_("m.1fe3b7e75f")) : 0;
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
        if (deletionToast) hideToast(deletionToast);
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
    settingsSnapshot = {
      token,
      repo,
      rememberToken,
      titleMode,
      editorFont,
      editorFontSize,
      editorLineHeight,
      autoSaveSeconds,
      issuePageSize,
      backgroundRefreshMinutes,
      lockSessionMinutes,
      languagePreference
    };
    error = '';
    notice = '';
    labelRenameDrafts = [];
    tokenInputValue = '';
    router.push('settings');
  }

  function restoreSettingsSnapshot() {
    if (!settingsSnapshot) return;
    ({
      token,
      repo,
      rememberToken,
      titleMode,
      editorFont,
      editorFontSize,
      editorLineHeight,
      autoSaveSeconds,
      issuePageSize,
      backgroundRefreshMinutes,
      lockSessionMinutes,
      languagePreference
    } = settingsSnapshot);
    setAppLocale(languagePreference);
    tokenInputValue = '';
    settingsSnapshot = null;
    labelRenameDrafts = [];
    error = '';
  }

  function closeSettings() {
    router.pop();
  }

  function forgetSettings() {
    if (!confirm($_("m.ad0db93efe"))) return;
    localStorage.removeItem(STORAGE_KEY);
    token = '';
    tokenInputValue = '';
    repo = '';
    user = null;
    repository = null;
    issues = [];
    totalIssues = 0;
    repositoryLabels = [];
    pendingNote = null;
    selectedIssue = null;
    settingsSnapshot = null;
    settingsRouteOverride = '';
    appState = 'setup';
    router.navigate('/');
    notice = $_("m.b5f846b636");
  }

  function excerpt(body) {
    const text = markdownToPlainText(body);
    return text || $_("m.0c3fd88e60");
  }

  function autoTitleExcerpt(body) {
    return firstLinePreview(body) || $_("m.0c3fd88e60");
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

{#if appState === 'booting' || appState === 'restoring'}
  <main class="boot-screen">
    <img class="brand-mark brand-mark-sm" src="./icon.svg" alt="" />
    <span class="text-secondary small">
      {appState === 'restoring' ? $_("m.dc21c1787a") : $_("m.e5f58095ac")}
    </span>
  </main>
{:else}
  {#if appState === 'setup' || (appState === 'connecting' && topRoute?.screen !== 'settings')}
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
  <main class="setup-shell settings-overlay container py-4 py-md-5">
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
              disabled={appState === 'connecting'}
              on:click={closeSettings}
            ><i class="bi bi-x-lg" aria-hidden="true"></i> {$_("m.bbfa773e5a")}</button>
          </div>

          {#if error}
            <div class="alert alert-danger" role="alert">{error}</div>
          {/if}
          {#if notice}
            <div class="alert alert-success" role="status">{notice}</div>
          {/if}

          <form on:submit|preventDefault={saveConfiguration}>
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
                <select id="title-mode" class="form-select" bind:value={titleMode}>
                  <option value="first-line">{$_("m.7358ee0f0a")}</option>
                  <option value="separate">{$_("m.4a13beb6d6")}</option>
                </select>
              </div>
              <div class="row g-2">
                <div class="col-sm-6">
                  <label class="form-label" for="editor-font">{$_("m.b97c4d4cdd")}</label>
                  <select id="editor-font" class="form-select" bind:value={editorFont}>
                    <option value="system">{$_("m.9d8d380806")}</option>
                    <option value="sans">{$_("m.ecc39dc539")}</option>
                    <option value="serif">{$_("m.a5c78a86fa")}</option>
                    <option value="mono">{$_("m.216fcddff2")}</option>
                  </select>
                </div>
                <div class="col-6 col-sm-3">
                  <label class="form-label" for="font-size">{$_("m.b7152342a2")}</label>
                  <input id="font-size" class="form-control" type="number" min="12" max="32" step="1" bind:value={editorFontSize} />
                </div>
                <div class="col-6 col-sm-3">
                  <label class="form-label" for="line-height">{$_("m.65be5133e7")}</label>
                  <input id="line-height" class="form-control" type="number" min="1.2" max="2.5" step="0.1" bind:value={editorLineHeight} />
                </div>
              </div>
              <div class="row g-2 mt-1">
                <div class="col-6">
                  <label class="form-label" for="auto-save-seconds">{$_("Auto-save delay")}</label>
                  <div class="input-group">
                    <input id="auto-save-seconds" class="form-control" type="number" min="3" max="30" step="1" bind:value={autoSaveSeconds} />
                    <span class="input-group-text">{$_("sec")}</span>
                  </div>
                </div>
                <div class="col-6">
                  <label class="form-label" for="issue-page-size">{$_("Notes per page")}</label>
                  <input id="issue-page-size" class="form-control" type="number" min="10" max="100" step="1" bind:value={issuePageSize} />
                </div>
              </div>
              <div class="mt-3">
                <label class="form-label" for="background-refresh-minutes">{$_('settings.backgroundRefreshInterval')}</label>
                <select id="background-refresh-minutes" class="form-select" bind:value={backgroundRefreshMinutes}>
                  {#each BACKGROUND_REFRESH_OPTIONS as minutes}
                    <option value={minutes}>
                      {minutes === 0 ? $_('settings.refreshDisabled') : `${minutes} ${$_('settings.minutes')}`}
                    </option>
                  {/each}
                </select>
              </div>
              <div class="mt-3">
                <label class="form-label" for="lock-session-minutes">{$_('settings.lockSessionDuration')}</label>
                <select id="lock-session-minutes" class="form-select" bind:value={lockSessionMinutes}>
                  {#each LOCK_SESSION_OPTIONS as minutes}
                    <option value={minutes}>
                      {minutes % 60 === 0
                        ? `${minutes / 60} ${$_('settings.hours')}`
                        : `${minutes} ${$_('settings.minutes')}`}
                    </option>
                  {/each}
                </select>
                <div class="form-text">{$_('settings.lockSessionHelp')}</div>
              </div>
              </fieldset>

              <TagSettings
                labels={repositoryLabels}
                busy={labelBusy || (appState === 'connecting' ? 'connecting' : '')}
                onCreate={createRepositoryLabel}
                onRenameDrafts={(drafts) => { labelRenameDrafts = drafts; }}
                onDelete={deleteRepositoryLabel}
              />

              <details class="pat-guide mcp-guide mb-4">
                <summary class="d-flex align-items-center justify-content-between gap-3">
                  <span>
                    <strong><i class="bi bi-robot me-2" aria-hidden="true"></i>{$_("m.5fe5834eaa")}</strong>
                    <small class="d-block text-secondary mt-1">{$_("m.5d80d297c5")}</small>
                  </span>
                  <span class="guide-chevron" aria-hidden="true">⌄</span>
                </summary>
                <div class="pat-guide-body border-top">
                  <p class="small text-secondary">
                    {$_("m.e83c891d49")}
                  </p>

                  <div class="mcp-repository mb-3">
                    <span class="small text-secondary">{$_("m.4b3f74b117")}</span>
                    <div class="input-group input-group-sm mt-1">
                      <input class="form-control font-monospace" value={mcpRepository} readonly aria-label={$_("m.d53b2b9304")} />
                      <button
                        type="button"
                        class="btn btn-outline-secondary"
                        on:click={() => copyMcpText(mcpRepository, $_("m.f200511c62"))}
                        disabled={!mcpRepository}
                      ><i class="bi bi-copy" aria-hidden="true"></i> {$_("m.af74f7c536")}</button>
                    </div>
                  </div>

                  <ol class="pat-steps mb-3">
                    <li>
                      <strong>{$_("m.3bfe3b4ca9")}</strong>
                      <span>{$_("m.a361d3f1f3")}</span>
                    </li>
                    <li>
                      <strong>{$_("m.d011f1e8c4")}</strong>
                      <span>{$_("m.b7aa3105c9")}</span>
                    </li>
                    <li>
                      <strong>{$_("m.7eb30a2712")}</strong>
                      <span>{$_("m.bbd3fa2b66")}</span>
                    </li>
                  </ol>

                  <p class="small text-secondary">
                    {$_("m.178f58ebdd")}
                    {' '}<code>&lt;!-- issue-note-attachment:... --&gt;</code>{' '}
                    {$_("m.fbdd445070")}
                  </p>

                  <label class="form-label small" for="mcp-usage-prompt">{$_("m.2838abde9d")}</label>
                  <textarea id="mcp-usage-prompt" class="form-control form-control-sm mcp-prompt mb-2" readonly value={mcpUsagePrompt}></textarea>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-primary w-100 mb-2"
                    on:click={() => copyMcpText(mcpUsagePrompt, $_("m.bacaacbf86"))}
                  ><i class="bi bi-copy" aria-hidden="true"></i> {$_("m.81979baa04")}</button>
                  <a
                    class="btn btn-sm btn-outline-secondary w-100"
                    href="https://github.com/github/github-mcp-server"
                    target={newContextTarget}
                    rel="noreferrer"
                  ><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> {$_("m.6b45c11893")}</a>
                </div>
              </details>

            <button class="btn btn-primary btn-lg w-100" disabled={appState === 'connecting'}>
              <i class="bi bi-check-lg" aria-hidden="true"></i>
              {appState === 'connecting' ? $_("m.984f7f9989") : $_("m.913aba9f96")}
            </button>
          </form>

          {#if localStorage.getItem(STORAGE_KEY)}
            <button class="btn btn-link text-danger w-100 mt-3" on:click={forgetSettings}>
              <i class="bi bi-trash3" aria-hidden="true"></i> {$_("m.da4c8914b3")}
            </button>
          {/if}
        </div>
      </div>
    </section>
  </main>
  {/if}
  {#if appState === 'ready' || topRoute?.screen === 'settings'}
  <div
    class="app-shell"
    class:mobile-detail-active={Boolean(contentRoute)}
  >
    {#if toastMessage}
      <div class="app-toast" role="status">{toastMessage}</div>
    {/if}
    <main class="note-workspace">
      <aside class="note-sidebar">
        <div class="sidebar-heading">
          <div class="sidebar-heading-main" class:is-hidden={selectionMode}>
            {#if user && repositoryIssuesUrl}
              <a
                class="sidebar-profile"
                href={repositoryIssuesUrl}
                target={newContextTarget}
                rel="noreferrer"
                aria-label={`${repo} Issues`}
              >
                <img class="avatar" src={user.avatar_url} alt={user.login} />
              </a>
            {/if}
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
            <div class="sidebar-new-note">
              <button
                class="btn btn-primary btn-sm btn-block w-100"
                on:click={newNote}
                disabled={Boolean(pendingNote) || selectionMode}
              >
                <i class="bi bi-plus-lg" aria-hidden="true"></i> {$_("m.2b7b05c002")}
              </button>
            </div>
            {#if !loading && visibleIssues.length === 0}
              <div class="list-status">{emptyMessage}</div>
            {:else}
              {#each visibleIssues as issue (issue.id)}
              <article
                class="note-list-row"
                class:active={selectedIssue?.id === issue.id}
                class:selection-mode={selectionMode}
                class:selected={selectedIssueIds.has(issue.id)}
                class:is-archived={state === 'closed'}
                on:pointerdown={(event) => beginIssueLongPress(event, issue)}
                on:pointermove={trackIssueLongPress}
                on:pointerup={finishIssueLongPress}
                on:pointercancel={finishIssueLongPress}
                on:contextmenu={(event) => handleIssueContextMenu(event, issue)}
              >
                {#if selectionMode && !issue.local}
                  <input
                    class="form-check-input note-row-checkbox"
                    type="checkbox"
                    checked={selectedIssueIds.has(issue.id)}
                    aria-label={$_('dynamic.openNote', { values: { title: issue.title } })}
                    on:click|stopPropagation={(event) => handleIssueSelectionClick(event, issue)}
                  />
                {/if}
                <button
                  class="note-row-hit-area"
                  on:click={(event) => handleIssueClick(event, issue)}
                  aria-label={$_('dynamic.openNote', { values: { title: issue.title } })}
                ></button>
                <div class="note-row-content">
                  {#if titleMode === 'separate'}
                    <span class="note-row-title">{markdownToPlainText(issue.title)}</span>
                  {/if}
                  <span
                    class="note-row-preview"
                    class:auto-title-preview={titleMode === 'first-line'}
                  >{isLockedTitle(issue.title)
                    ? titleMode === 'first-line' ? markdownToPlainText(issue.title) : '잠금된 노트입니다'
                    : titleMode === 'first-line' ? autoTitleExcerpt(issue.body) : excerpt(issue.body)}</span>
                  <span class="note-row-meta">
                    {issue.local ? $_("m.6f65454664") : `#${issue.number} · ${formatDate(issue.updated_at)}`}
                  </span>
                </div>
                {#if issue.labels?.length}
                  <div class="note-row-labels">
                    {#each issue.labels as label (label.id || label.name)}
                      <button
                        type="button"
                        style={`--tag-color:#${labelColor(label)}`}
                        on:click={(event) => handleIssueLabelClick(event, issue, label.name)}
                      >#{label.name}</button>
                    {/each}
                  </div>
                {/if}
                {#if refreshingIssueNumber === issue.number}
                  <span class="note-row-refresh-spinner" aria-label={$_("m.6e6e21803f")}>
                    <BrailleSpinner active />
                  </span>
                {/if}
              </article>
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
            {#if route.screen === 'new' || routeIssue}
            <div
              class="note-detail-layer"
              class:active={route === contentRoute}
              aria-hidden={route !== contentRoute}
            >
            <NoteEditor
              {token}
              {repo}
              issue={routeIssue}
              initialDraft={route.screen === 'new' ? pendingNote : null}
              ignoreRecoveredDraft={route.screen === 'new' && Boolean(pendingNote?.ignoreRecoveredDraft)}
              externalPasteRequest={route === contentRoute ? externalPasteRequest : null}
              refreshRequest={routeIssue ? issueRefreshRequests[routeIssue.number] || 0 : 0}
              allocatedIssue={route.screen === 'new' ? pendingNote?.allocatedIssue : null}
              allocationPromise={route.screen === 'new' ? pendingAllocation : null}
              editorId={route.segment.replace(/[^a-zA-Z0-9_-]/g, '-')}
              archived={state === 'closed'}
              {titleMode}
              font={editorFont}
              fontSize={editorFontSize}
              lineHeight={editorLineHeight}
              {autoSaveSeconds}
              {lockPin}
              {lockSessionMinutes}
              onSetLockSession={setLockSession}
              paused={topRoute?.screen === 'settings' || route !== contentRoute || selectionMode}
              readOnly={selectionMode}
              availableLabels={repositoryLabels}
              {labelMutation}
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
          <div class="detail-empty">
            <p>{$_("m.15147e26a7")}</p>
          </div>
        {/if}
      </section>
    </main>
  </div>
  {/if}
{/if}
