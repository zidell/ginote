<script>
  import { onMount, tick } from 'svelte';
  import { createStackRouter } from 'spa-stack-router';
  import AddWorkspaceDialog from './lib/AddWorkspaceDialog.svelte';
  import BrailleSpinner from './lib/BrailleSpinner.svelte';
  import DisplaySettings from './lib/DisplaySettings.svelte';
  import HelpOverlay from './lib/HelpOverlay.svelte';
  import NoteEditor from './lib/NoteEditor.svelte';
  import NoteList from './lib/NoteList.svelte';
  import SelectionTagPanel from './lib/SelectionTagPanel.svelte';
  import SelectionToolbar from './lib/SelectionToolbar.svelte';
  import SetupWizard from './lib/SetupWizard.svelte';
  import TagSettings from './lib/TagSettings.svelte';
  import WorkspaceList from './lib/WorkspaceList.svelte';
  import WorkspaceSwitcher from './lib/WorkspaceSwitcher.svelte';
  import VoiceRecorder from './lib/VoiceRecorder.svelte';
  import VoiceSettings from './lib/VoiceSettings.svelte';
  import {
    DEFAULT_REFINEMENT_MODEL,
    DEFAULT_REFINEMENT_PROMPT,
    DEFAULT_TRANSCRIPTION_MODEL,
    loadVoiceSettings
  } from './lib/voice-settings.js';
  import { createDeletionQueue, findEntryForIssue, queuedIssueIds } from './lib/deletion-queue.js';
  import { createLongPress } from './lib/long-press.js';
  import { createToast } from './lib/toast.js';
  import { createTranscriptionHints } from './lib/transcription-hints.js';
  import { createKeyboardReadyClass } from './lib/keyboard-ready-class.js';
  import { isWebFont, loadWebFont } from './lib/editor-fonts.js';
  import { _, locale as activeLocale } from 'svelte-i18n';
  import { setAppLocale } from './lib/i18n.js';
  import {
    hasScreen,
    helpTopicFromRoute,
    HELP_TOPICS,
    isContentRoute,
    isHomeOrNoteHash,
    labelFromRoutes,
    queryMatchesLabel,
    segmentsWithPromotedNote,
    segmentsWithRenamedTag,
    tagRouteSegment
  } from './lib/app-routes.js';
  import {
    arrowDirection,
    hasNoModifier,
    isDeleteShortcut,
    isEditableElement,
    isFormControl,
    isNewNoteShortcut,
    isNoteRowButton,
    isShiftOnly,
    isTextControl,
    workspaceNumberFromEvent
  } from './lib/keyboard-shortcuts.js';
  import { rangeSelection, reconcileSelection, toggleSelection } from './lib/issue-selection.js';
  import {
    hasIssueLabel,
    limitTagInput,
    mergeLabels,
    replaceIssueLabel,
    sortLabels
  } from './lib/issue-labels.js';
  import {
    applyPendingPin,
    applyPendingPinToList,
    restorePinnedList,
    samePinIssue,
    syncPinnedList,
    uniquePinnedIssues
  } from './lib/pinned-issues.js';
  import { renameDraftLabels } from './lib/draft-store.js';
  import {
    appendVoiceAttachmentLink,
    composeVoiceIssue,
    knownTagNames,
    normalizeSuggestedTitle,
    normalizeVoiceParagraphs,
    voiceAttachmentLink,
    voiceAudioFile
  } from './lib/voice-notes.js';
  import { friendlyError } from './lib/error-messages.js';
  import { clampSidebarWidth, loadSidebarWidth, saveSidebarWidth, SIDEBAR_WIDTH_DEFAULT } from './lib/sidebar-width.js';
  import {
    markExpiredAttachmentsPruned,
    purgeExpiredAttachments,
    shouldPruneExpiredAttachments
  } from './lib/attachment-prune.js';
  import { MergeError, mergeIssues } from './lib/merge-notes.js';
  import {
    hasPinLabel,
    isPinLabel,
    PIN_LABEL_NAME,
    visibleLabels as filterVisibleLabels,
    withPinState
  } from './lib/pin-label.js';
  import { makePatCreationUrl, normalizeToken, parseRepositoryAddress } from './lib/repo-address.js';
  import {
    applyTheme,
    createWorkspaceRecord,
    finalizePreferences,
    loadSettingsDocument,
    normalizePreferences,
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
    addIssueLabel,
    createIssue,
    createIssueComment,
    createLabel,
    listIssuesPage,
    listLabels,
    removeIssueLabel,
    removeLabel,
    renameLabel,
    searchIssuesPage,
    setIssueLabels,
    setIssueState,
    uploadAttachment,
    verifyConnection
  } from './lib/github.js';

  const DELETE_DELAY_MS = 3000;
  // 창/탭 전환은 짧은 시간에 focus와 visibilitychange를 모두 일으킬 수 있다.
  // GitHub API를 중복 호출하지 않도록 활성화 갱신은 이 간격 안에서 한 번만 한다.
  const ACTIVE_PAGE_REFRESH_COOLDOWN_MS = 30 * 1000;
  const PINNED_ISSUE_PAGE_SIZE = 100;
  // Escape는 열린 UI와 포커스를 먼저 정리한 뒤, 남은 경우에만 아래 전역
  // 핸들러가 뒤로가기를 수행한다. 라우터의 자동 keyup 뒤로가기를 켜두면
  // 드롭다운이 keydown에서 닫힌 뒤에도 같은 Escape의 keyup이 라우터에
  // 도달해 게시물까지 빠져나가 버린다.
  const router = createStackRouter({ mode: 'hashbang', escToBack: false });

  let token = '';
  let tokenInputValue = '';
  let repo = '';
  let rememberToken = true;
  let workspaces = [];
  let activeWorkspaceId = '';
  let workspaceNoteCounts = {};
  let workspaceWizardOpen = false;
  let appState = 'booting';
  let user = null;
  let repository = null;
  let issues = [];
  // GitHub의 목록 API는 이슈 재개방 직후 잠시 이전 결과를 줄 수 있다. 그 동안
  // 복원한 노트를 노트 탭에서 바로 보여 주고, API 응답에 포함되면 이 보관분을
  // 자연스럽게 해제한다.
  let pendingRestoredIssues = [];
  let pendingTrashedIssues = [];
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
  // Hybrid 검색은 GitHub가 최대 100개만 한 번에 반환한다. 받은 결과는 여기서
  // 보관하고, 목록에는 사용자가 정한 단위만 조금씩 넣는다.
  let searchResultItems = [];
  let searchResultLimitReached = false;
  // 목록 변경 중에 시작된 요청이 나중에 도착해, 이미 반영한 삭제/복원을
  // 오래된 서버 응답으로 되돌리지 않도록 하는 세대 번호다.
  let issueListMutationVersion = 0;
  let error = '';
  let notice = '';
  let routeStack = [];
  let helpTopic = null;
  // 표시·편집 환경설정이다. 저장 형식(settings-storage.js의 normalizePreferences)과 같은 모양이다.
  let preferences = normalizePreferences();
  let touchDevice = false;
  let activePageRefreshInFlight = false;
  let lastActivePageRefreshAt = 0;
  let labelBusy = {};
  const labelRenameQueues = new Map();
  let labelMutation = null;
  let labelMutationSequence = 0;
  let settingsRouteOverride = '';
  let settingsEntryPageSize = 0;
  let settingsEntrySignature = '';
  let pinBusyIssueNumber = null;
  let pendingPinMutation = null;
  let nextPinMutationId = 0;
  let sidebarWidth = SIDEBAR_WIDTH_DEFAULT;
  let sidebarResizing = false;
  let noteList;
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
  let selectionTagBusy = false;
  let mergeBusy = false;
  let voiceApiKey = '';
  let voiceRefinementPrompt = DEFAULT_REFINEMENT_PROMPT;
  let voiceTranscriptionModel = DEFAULT_TRANSCRIPTION_MODEL;
  let voiceRefinementModel = DEFAULT_REFINEMENT_MODEL;
  let preserveOriginalVoiceAudio = false;
  let openVoiceAfterSettings = false;
  let focusVoiceSettingsAfterOpen = false;
  let voiceHasUnrecordedAudio = false;
  let allowVoiceRouteExit = false;
  let voiceRecordingDestination = null;
  let voiceCommentSequence = 0;
  let voiceComment = null;
  let voiceBodySequence = 0;
  let voiceBody = null;
  let voiceCommentEditSequence = 0;
  let voiceCommentEdit = null;
  let voiceSettings;

  const toast = createToast();
  const deletionQueue = createDeletionQueue({ delayMs: DELETE_DELAY_MS, onExpire: runPendingIssueDeletion });
  const longPress = createLongPress({ onLongPress: selectIssueByLongPress });
  const transcriptionHints = createTranscriptionHints(() => ({ token, repo }));
  const keyboardReadyClass = createKeyboardReadyClass(() => touchDevice);

  $: selectionMode = selectedIssueIds.size > 0;
  $: selectedIssues = visibleIssues.filter((issue) => !issue.local && selectedIssueIds.has(issue.id));
  $: pendingIssueDeletionIds = queuedIssueIds($deletionQueue);
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
  $: if (topRoute?.screen === 'settings' && focusVoiceSettingsAfterOpen) {
    focusVoiceSettingsAfterOpen = false;
    void focusVoiceSettings();
  }
  // 안내 화면도 다른 화면과 마찬가지로 URL 스택의 한 레이어다. 따라서 새로고침,
  // 공유 URL, 브라우저 뒤로가기 모두 같은 방식으로 동작한다.
  $: helpTopic = helpTopicFromRoute(topRoute);
  $: contentRoutes = routeStack.filter(isContentRoute);
  $: contentRoute = contentRoutes.at(-1);
  $: isNewRoute = contentRoute?.screen === 'new';
  $: queryIsLabelFilter = queryMatchesLabel(appliedQuery, activeLabel);
  $: pendingMatchesLabel = !activeLabel || hasIssueLabel(pendingNote, activeLabel);
  $: visibleIssues = pendingNote && state === 'open' && (!appliedQuery || queryIsLabelFilter) && pendingMatchesLabel
    ? [pendingNote, ...issues.filter((issue) => issue.number !== pendingNote.number)]
    : issues;
  $: pinnedIssueIds = new Set(pinnedIssues.map((issue) => issue.id));
  $: unpinnedVisibleIssues = visibleIssues.filter((issue) => !pinnedIssueIds.has(issue.id));
  $: visibleRepositoryLabels = filterVisibleLabels(repositoryLabels);

  function setLockSession(pin) {
    clearTimeout(lockSessionTimer);
    lockPin = pin;
    if (!pin) return;
    lockSessionTimer = setTimeout(() => {
      lockPin = '';
    }, preferences.lockSessionMinutes * 60 * 1000);
  }

  onMount(() => {
    const touchMedia = matchMedia('(pointer: coarse)');
    const updateTouchDevice = () => {
      touchDevice = touchMedia.matches;
      keyboardReadyClass.schedule();
    };
    updateTouchDevice();
    touchMedia.addEventListener('change', updateTouchDevice);
    sidebarWidth = loadSidebarWidth();
    router.init();
    window.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('paste', handleGlobalPaste);
    const detachKeyboardReadyClass = keyboardReadyClass.attach();
    window.addEventListener('focus', refreshWhenPageBecomesActive);
    document.addEventListener('visibilitychange', refreshWhenPageBecomesActive);
    // iOS의 엣지 스와이프는 라우터가 스택을 갱신하기 전에 기존 textarea의
    // 포커스를 복원할 수 있다. 제스처 시작과 history 이벤트에서 먼저 blur해
    // 뒤로 가는 순간 가상 키보드가 잠깐 나타나는 것을 막는다.
    window.addEventListener('popstate', blurFocusedTextControl);
    window.addEventListener('hashchange', blurFocusedTextControl);
    document.addEventListener('touchstart', blurForEdgeBackSwipe, true);
    const unsubscribe = router.subscribe((stack) => {
      const targetSignature = stack.map((route) => route.segment).join('/');
      if (targetSignature === pendingRouteTransition) return;
      const hadContent = routeStack.some(isContentRoute);
      const hasContent = stack.some(isContentRoute);
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
      // 설정 위에 안내 레이어를 쌓았다가 닫아도 설정을 떠난 것이 아니므로,
      // 최상단이 아니라 스택 전체에서 설정 경로의 유무를 비교한다.
      const wasInSettings = hasScreen(routeStack, 'settings');
      const isInSettings = hasScreen(stack, 'settings');
      const wasInVoice = hasScreen(routeStack, 'voice');
      const isInVoice = hasScreen(stack, 'voice');
      const previousLabel = labelFromRoutes(routeStack);
      const nextLabel = labelFromRoutes(stack);
      routeStack = stack;
      if (wasInVoice && !isInVoice && voiceHasUnrecordedAudio && !allowVoiceRouteExit) {
        if (!confirm('기록하지 않은 녹음을 전부 취소하시겠습니까?')) {
          router.push('voice');
          return;
        }
      }
      if (wasInVoice && !isInVoice) {
        voiceHasUnrecordedAudio = false;
        allowVoiceRouteExit = false;
      }
      activeLabel = nextLabel;
      if (previousLabel !== nextLabel) {
        if (nextLabel) {
          query = `#${nextLabel}`;
          appliedQuery = query;
        } else {
          if (queryMatchesLabel(query, previousLabel)) query = '';
          if (queryMatchesLabel(appliedQuery, previousLabel)) appliedQuery = '';
        }
      }
      if (wasInSettings && !isInSettings) {
        applySettingsChanges();
        if (openVoiceAfterSettings) {
          openVoiceAfterSettings = false;
          if (voiceApiKey.trim()) {
            void openVoiceRecording();
            return;
          }
        }
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
    ({
      apiKey: voiceApiKey,
      refinementPrompt: voiceRefinementPrompt,
      transcriptionModel: voiceTranscriptionModel,
      refinementModel: voiceRefinementModel,
      preserveOriginalAudio: preserveOriginalVoiceAudio
    } = loadVoiceSettings());
    if (settingsDocument) {
      workspaces = settingsDocument.workspaces;
      activeWorkspaceId = settingsDocument.activeWorkspaceId;
      preferences = settingsDocument.preferences;
      applyTheme(preferences.theme);
      setAppLocale(preferences.language);
      if (isWebFont(preferences.editorFont)) void loadWebFont(preferences.editorFont);
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

    return () => {
      clearTimeout(lockSessionTimer);
      longPress.destroy();
      toast.destroy();
      deletionQueue.cancelAll(true);
      touchMedia.removeEventListener('change', updateTouchDevice);
      window.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('paste', handleGlobalPaste);
      detachKeyboardReadyClass();
      window.removeEventListener('focus', refreshWhenPageBecomesActive);
      document.removeEventListener('visibilitychange', refreshWhenPageBecomesActive);
      window.removeEventListener('popstate', blurFocusedTextControl);
      window.removeEventListener('hashchange', blurFocusedTextControl);
      document.removeEventListener('touchstart', blurForEdgeBackSwipe, true);
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
    const route = routeStack.findLast(isContentRoute);

    // 새 노트는 번호 할당 직후 주소가 note.{번호}로 바뀌지만 issues 목록에는
    // 아직 없다. 이 경우를 "삭제된 옛날 URL"로 오인해 홈으로 되돌리면 안 되므로
    // pendingNote와 대조해 먼저 처리한다.
    if (isPendingNoteRoute(route)) {
      selectedIssue = pendingNote;
      synchronizeKeyboardFocusWithDetail(pendingNote);
      return;
    }

    if (route?.screen === 'note') {
      selectedIssue = issueForRoute(route);
      if (selectedIssue) {
        lastOpenedIssueIds.set(activeWorkspaceId, selectedIssue.id);
        synchronizeKeyboardFocusWithDetail(selectedIssue);
      }
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
    // 고정 노트는 현재 페이지에 없거나 검색/필터 결과에서 빠져도 별도
    // 라벨 조회 결과로 목록에 남는다. 그런 노트를 눌렀을 때도 같은 편집기를
    // 열어야 하므로 일반 목록 다음에 고정 목록을 fallback으로 사용한다.
    // 입력할 때마다 목록 미리보기는 갱신하지만, 활성 편집기에는 새 목록
    // 객체를 다시 넘기지 않는다. macOS WebView에서 매번 바뀌는 issue prop이
    // textarea의 포커스와 스크롤 보정을 다시 일으킬 수 있다.
    if (
      contentRoute?.segment === route.segment
      && selectedIssue?.number === issueNumber
    ) return selectedIssue;

    return issues.find((issue) => issue.number === issueNumber)
      || pinnedIssues.find((issue) => issue.number === issueNumber)
      || null;
  }

  function synchronizeKeyboardFocusWithDetail(issue) {
    if (!issue) return;
    const issueId = String(issue.id);
    if (keyboardFocusedIssueId !== issueId) keyboardEnteredIssueId = '';
    keyboardFocusedIssueId = issueId;
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
    saveSettings();
  }

  function saveSettings() {
    saveSettingsDocument({ workspaces, activeWorkspaceId, preferences });
  }

  function refreshWhenPageBecomesActive() {
    // visibilitychange는 숨김 상태로 전환될 때도 발생하고, focus는 같은 전환에서
    // 함께 올 수 있다. 둘 모두 이 함수로 받되 실제 요청은 아래 잠금에서 하나로 합친다.
    if (document.visibilityState !== 'visible') return;
    void refreshActivePage();
  }

  async function refreshActivePage() {
    if (
      activePageRefreshInFlight
      || appState !== 'ready'
      || topRoute?.screen === 'settings'
      || Date.now() - lastActivePageRefreshAt < ACTIVE_PAGE_REFRESH_COOLDOWN_MS
    ) return;

    activePageRefreshInFlight = true;
    lastActivePageRefreshAt = Date.now();
    try {
      // 목록은 화면을 막지 않고 최신 항목과 태그 상태를 합친다. 열린 노트는
      // 목록 응답만으로 본문을 교체하지 않으므로 별도 조회 요청을 보낸다.
      await loadIssues(true);
      const issueNumber = selectedIssue?.local ? null : selectedIssue?.number;
      if (issueNumber) {
        issueRefreshRequests = {
          ...issueRefreshRequests,
          [issueNumber]: ++issueRefreshSequence
        };
      }
    } finally {
      activePageRefreshInFlight = false;
    }
  }

  function startSidebarResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    sidebarResizing = true;

    function handleMove(moveEvent) {
      sidebarWidth = clampSidebarWidth(startWidth + (moveEvent.clientX - startX));
    }

    function handleUp() {
      sidebarResizing = false;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      saveSidebarWidth(sidebarWidth);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  async function pruneExpiredAttachments() {
    if (pruningExpiredAttachments || !shouldPruneExpiredAttachments(repo)) return;
    pruningExpiredAttachments = true;
    const requestedToken = token;
    const requestedRepo = repo;
    const completed = await purgeExpiredAttachments(requestedToken, requestedRepo, {
      isOpen: (issueNumber) => selectedIssue?.number === issueNumber
    });
    if (completed && token === requestedToken && repo === requestedRepo) markExpiredAttachmentsPruned(requestedRepo);
    pruningExpiredAttachments = false;
  }

  function pinMutationMatchesContext(mutation, workspaceId = activeWorkspaceId, requestedToken = token, requestedRepo = repo) {
    return Boolean(
      mutation
      && pendingPinMutation?.id === mutation.id
      && mutation.workspaceId === workspaceId
      && mutation.token === requestedToken
      && mutation.repo === requestedRepo
    );
  }

  function pendingPinMutationFor(workspaceId, requestedToken, requestedRepo) {
    return pinMutationMatchesContext(
      pendingPinMutation,
      workspaceId,
      requestedToken,
      requestedRepo
    )
      ? pendingPinMutation
      : null;
  }

  function currentIssueForPinMutation(mutation) {
    return [
      selectedIssue,
      ...issues,
      ...pinnedIssues
    ].find((issue) => samePinIssue(issue, mutation.issue)) || mutation.optimisticIssue;
  }

  function applyPinIssue(issue) {
    if (!issue) return;
    const syncedIssue = syncPinnedIssue(issue);
    issues = issues.map((item) => samePinIssue(item, issue) ? syncedIssue : item);
    if (samePinIssue(selectedIssue, issue)) selectedIssue = syncedIssue;
  }

  function restorePinMutation(mutation) {
    if (!pinMutationMatchesContext(mutation)) return;
    const currentIssue = currentIssueForPinMutation(mutation);
    const restoreIssue = (source) => withPinState(
      source || currentIssue || mutation.issue,
      mutation.wasPinned
    );

    issues = issues.map((item) => samePinIssue(item, mutation.issue)
      ? restoreIssue(item)
      : item);
    if (samePinIssue(selectedIssue, mutation.issue)) {
      selectedIssue = restoreIssue(selectedIssue);
    }

    pinnedIssues = restorePinnedList(pinnedIssues, mutation, restoreIssue);
  }

  function invalidatePendingPinMutation() {
    pendingPinMutation = null;
    pinBusyIssueNumber = null;
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
      if (showSuccess) notice = $_("m.2273eb0763");
      await Promise.all([loadIssues(), loadRepositoryLabels()]);
      appState = 'ready';
      void transcriptionHints.flush();
      applyRoute();
      pruneExpiredAttachments();
    } catch (reason) {
      appState = 'setup';
      error = friendlyError(reason);
    }
  }

  function isUnfilteredNoteView(stateValue = state, queryValue = appliedQuery, labelValue = activeLabel) {
    return stateValue === 'open' && !String(queryValue || '').trim() && !labelValue;
  }

  function setWorkspaceNoteCount(workspaceId, count) {
    const numericCount = Number(count);
    if (!workspaceId || !Number.isFinite(numericCount) || numericCount < 0) return;
    workspaceNoteCounts = {
      ...workspaceNoteCounts,
      [workspaceId]: Math.floor(numericCount)
    };
  }

  function adjustWorkspaceNoteCount(workspaceId, delta) {
    const currentCount = workspaceNoteCounts[workspaceId];
    if (!Number.isFinite(currentCount)) return;
    setWorkspaceNoteCount(workspaceId, currentCount + delta);
  }

  function removeWorkspaceNoteCount(workspaceId) {
    if (!workspaceId || !(workspaceId in workspaceNoteCounts)) return;
    const nextCounts = { ...workspaceNoteCounts };
    delete nextCounts[workspaceId];
    workspaceNoteCounts = nextCounts;
  }

  async function switchWorkspace(workspaceId) {
    if (!workspaceId || workspaceId === activeWorkspaceId) return;
    const target = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!target) return;
    invalidatePendingPinMutation();

    // 나가는 워크스페이스의 목록/필터 상태를 캐시해 다시 돌아왔을 때 즉시 보여준다(stale-while-revalidate).
    setCachedIssueList(activeWorkspaceId, {
      issues, repositoryLabels, issuePage, hasMoreIssues, totalIssues,
      state, query, appliedQuery, activeLabel,
      noteCount: workspaceNoteCounts[activeWorkspaceId],
      openNoteSegment: contentRoute?.screen === 'note' ? contentRoute.segment : '',
      sidebarScroll: noteList?.captureScroll()
    });

    deletionQueue.cancelAll(true);
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
    pendingRestoredIssues = [];
    pendingTrashedIssues = [];
    query = '';
    appliedQuery = '';
    activeLabel = '';

    activeWorkspaceId = workspaceId;
    pinnedIssues = [];
    token = target.token;
    repo = target.repo;
    transcriptionHints.reset();
    rememberToken = target.rememberToken;
    user = null;
    repository = null;
    error = '';
    notice = '';
    saveSettings();

    const cached = getCachedIssueList(workspaceId, preferences.workspaceCacheMinutes);
    if (cached) {
      ({ issues, repositoryLabels, issuePage, hasMoreIssues, totalIssues, state, query, appliedQuery, activeLabel } = cached);
      setWorkspaceNoteCount(workspaceId, cached.noteCount);
      appState = 'ready';
      // 유효 기간 안의 캐시라면 그 워크스페이스에서 마지막으로 열던 노트도 되돌린다.
      router.navigate(cached.openNoteSegment ? `/${cached.openNoteSegment}` : '/');
      await tick();
      noteList?.restoreScroll(cached.sidebarScroll);
    } else {
      issues = [];
      pinnedIssues = [];
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
      // 캐시로 이미 목록을 보여준 상태라면 로딩 스피너 없이 조용히 갱신한다.
      await Promise.all([loadIssues(Boolean(cached)), loadRepositoryLabels()]);
      applyRoute();
      void transcriptionHints.flush();
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
    workspaceWizardOpen = true;
  }

  function forgetWorkspace(workspaceId) {
    if (activeWorkspaceId === workspaceId) invalidatePendingPinMutation();
    workspaces = workspaces.filter((workspace) => workspace.id !== workspaceId);
    invalidateCachedIssueList(workspaceId);
    removeWorkspaceNoteCount(workspaceId);
    saveSettings();
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
    saveSettings();
  }

  function renameWorkspace(workspaceId, displayName) {
    workspaces = renameWorkspaceRecord(workspaces, workspaceId, displayName);
    saveSettings();
  }

  function leaveWorkspace(workspaceId) {
    const target = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!target) return;
    const repoLabel = workspaceDisplayName(target);
    if (!confirm($_('workspace.leaveConfirm', { values: { repo: repoLabel } }))) return;
    forgetWorkspace(workspaceId);
    notice = $_('workspace.leftNotice', { values: { repo: repoLabel } });
  }

  // 목록 요청을 보낸 시점의 조건이다. 응답이 왔을 때 조건이 바뀌었으면 그 응답은 버린다.
  function snapshotListRequest() {
    const request = {
      workspaceId: activeWorkspaceId,
      token,
      repo,
      query: appliedQuery,
      state,
      label: activeLabel,
      mutationVersion: issueListMutationVersion
    };
    // #태그 검색어는 태그 필터로 처리하므로 본문 검색어로 쓰지 않는다.
    request.term = queryMatchesLabel(request.query, request.label) ? '' : request.query;
    return request;
  }

  function isCurrentListRequest(request) {
    return request.workspaceId === activeWorkspaceId
      && request.token === token
      && request.repo === repo
      && request.query === appliedQuery
      && request.state === state
      && request.label === activeLabel
      && request.mutationVersion === issueListMutationVersion;
  }

  function fetchIssuePage(request, page) {
    return request.term.trim()
      ? searchIssuesPage(request.token, request.repo, request.state, request.term, request.label, page, Date.now(), preferences.issuePageSize)
      : listIssuesPage(request.token, request.repo, request.state, request.label, page, Date.now(), preferences.issuePageSize);
  }

  async function loadIssues(background = false) {
    if (background && loading) return;
    const request = snapshotListRequest();
    if (!background) {
      error = '';
      loading = true;
    }
    try {
      const [result, pinnedResult] = await Promise.all([
        fetchIssuePage(request, 1),
        listIssuesPage(
          request.token,
          request.repo,
          request.state,
          PIN_LABEL_NAME,
          1,
          Date.now(),
          PINNED_ISSUE_PAGE_SIZE
        )
      ]);
      if (!isCurrentListRequest(request)) return;
      const pendingPin = pendingPinMutationFor(
        request.workspaceId,
        request.token,
        request.repo
      );
      const allSearchItems = request.term.trim()
        ? result.items.map((issue) => applyPendingPin(issue, pendingPin))
        : [];
      const fetchedResultItems = request.term.trim()
        ? allSearchItems.slice(0, preferences.issuePageSize)
        : result.items.map((issue) => applyPendingPin(issue, pendingPin));
      const pendingStateIssues = !request.term.trim() && !request.label
        ? request.state === 'open' ? pendingRestoredIssues : pendingTrashedIssues
        : [];
      const fetchedIssueIds = new Set(fetchedResultItems.map((issue) => issue.id));
      const resultItems = pendingStateIssues.length
        ? [
          ...pendingStateIssues.filter((issue) => !fetchedIssueIds.has(issue.id)),
          ...fetchedResultItems
        ]
        : fetchedResultItems;
      if (pendingStateIssues.length) {
        if (request.state === 'open') {
          pendingRestoredIssues = pendingRestoredIssues.filter((issue) => !fetchedIssueIds.has(issue.id));
        } else {
          pendingTrashedIssues = pendingTrashedIssues.filter((issue) => !fetchedIssueIds.has(issue.id));
        }
      }
      if (request.term.trim()) {
        searchResultItems = allSearchItems;
        searchResultLimitReached = result.totalCount > allSearchItems.length;
        issues = resultItems;
        issuePage = 1;
        hasMoreIssues = allSearchItems.length > preferences.issuePageSize;
      } else if (background && issuePage > 1) {
        searchResultItems = [];
        searchResultLimitReached = false;
        const refreshedIds = new Set(resultItems.map((issue) => issue.id));
        issues = [...resultItems, ...issues.filter((issue) => !refreshedIds.has(issue.id))];
      } else {
        searchResultItems = [];
        searchResultLimitReached = false;
        issues = resultItems;
        issuePage = 1;
        hasMoreIssues = result.hasMore;
      }
      pinnedIssues = applyPendingPinToList(
        uniquePinnedIssues(pinnedResult.items),
        pendingPin
      );
      reconcileIssueSelection(issues);
      if (result.totalCount !== null) {
        const displayedTotal = request.term.trim()
          ? Math.min(result.totalCount, allSearchItems.length)
          : result.totalCount + pendingStateIssues.filter((issue) => !fetchedIssueIds.has(issue.id)).length;
        totalIssues = displayedTotal;
        if (isUnfilteredNoteView(request.state, request.query, request.label)) {
          setWorkspaceNoteCount(request.workspaceId, displayedTotal);
        }
      }
      applyRoute();
    } catch (reason) {
      if (!background && request.workspaceId === activeWorkspaceId) error = friendlyError(reason);
    } finally {
      if (!background && request.workspaceId === activeWorkspaceId) loading = false;
    }
  }

  async function loadMoreIssues() {
    if (loading || loadingMore || !hasMoreIssues) return;
    const request = snapshotListRequest();
    const nextPage = issuePage + 1;
    loadingMore = true;
    error = '';
    try {
      if (request.term.trim() && searchResultItems.length) {
        const nextItems = searchResultItems.slice(issues.length, issues.length + preferences.issuePageSize);
        issues = [...issues, ...nextItems];
        issuePage = nextPage;
        hasMoreIssues = issues.length < searchResultItems.length;
        reconcileIssueSelection(issues);
        applyRoute();
        return;
      }
      const result = await fetchIssuePage(request, nextPage);
      if (!isCurrentListRequest(request)) return;
      const pendingPin = pendingPinMutationFor(
        request.workspaceId,
        request.token,
        request.repo
      );
      const resultItems = result.items.map((issue) => applyPendingPin(issue, pendingPin));
      const knownIds = new Set(issues.map((issue) => issue.id));
      issues = [...issues, ...resultItems.filter((issue) => !knownIds.has(issue.id))];
      issuePage = nextPage;
      hasMoreIssues = result.hasMore;
      if (result.totalCount !== null) {
        totalIssues = result.totalCount;
        if (isUnfilteredNoteView(request.state, request.query, request.label)) {
          setWorkspaceNoteCount(request.workspaceId, result.totalCount);
        }
      }
      applyRoute();
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      if (request.workspaceId === activeWorkspaceId) loadingMore = false;
    }
  }

  async function submitSearch() {
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
      const exactLabel = visibleRepositoryLabels.find(
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
    void submitSearch();
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
    synchronizeKeyboardFocusWithDetail(pendingNote);
    if (topRoute?.screen === 'note') {
      router.replace('new');
    } else {
      router.navigate('new');
    }
    if (hadQuery || stateChanged) loadIssues();
  }

  function handleGlobalKeydown(event) {
    if (mergeBusy) {
      event.preventDefault();
      return;
    }
    if (topRoute?.screen === 'voice') {
      if (event.key === 'Escape') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('voice-close-request'));
      }
      return;
    }
    if (event.key === 'Escape') {
      // 삭제 유예는 Esc로 가장 최근 것부터 되돌린다. 목록 행 버튼에 포커스가
      // 남아 있어도 첫 Esc가 단순 blur로 소비되지 않게 이보다 먼저 처리한다.
      if (deletionQueue.cancelMostRecent()) {
        event.preventDefault();
        return;
      }
      // 컴포넌트가 먼저 처리한 Escape(드롭다운 닫기·입력 취소)는
      // 라우팅까지 이어지지 않게 한다.
      // Escape의 첫 번째 의미는 항상 현재 포커스를 해제하는 것이다.
      // 포커스가 드롭다운 안에 있으면 드롭다운도 같은 동작에서 닫는다.
      const activeElement = document.activeElement;
      if (activeElement && activeElement !== document.body && activeElement !== document.documentElement) {
        event.preventDefault();
        const tagPicker = activeElement.closest?.('.tag-picker');
        if (tagPicker) {
          tagPicker.dispatchEvent(new CustomEvent('escape-close'));
        } else if (activeElement.closest?.('.sidebar-selection-tags')) {
          closeSelectionTagPanel();
        }
        activeElement.blur?.();
        return;
      }

      event.preventDefault();
      if (selectionTagPanelOpen) {
        closeSelectionTagPanel();
        return;
      }

      const openTagPicker = document.querySelector('.tag-picker > button[aria-expanded="true"]')?.parentElement;
      if (openTagPicker) {
        openTagPicker.dispatchEvent(new CustomEvent('escape-close'));
        return;
      }

      if (selectionMode) {
        clearIssueSelection();
        return;
      }
      router.pop();
      return;
    }

    const activeElement = document.activeElement;
    const direction = arrowDirection(event);
    const plainKey = hasNoModifier(event);
    const freshPlainKey = plainKey && !event.repeat;
    const canNavigate = canUseKeyboardListNavigation();
    const canUseShortcuts = !selectionMode && canNavigate;

    // Shift+↑/↓: 목록 행에서 범위 선택을 넓힌다.
    if (canNavigate && isNoteRowButton(activeElement) && isShiftOnly(event) && direction) {
      event.preventDefault();
      extendIssueSelection(direction);
      return;
    }
    // Space: 포커스된 목록 행을 골라 다중 선택을 시작한다.
    if (!selectionMode && canNavigate && isNoteRowButton(activeElement) && freshPlainKey && event.key === ' ') {
      const issue = keyboardFocusedListIssue();
      if (!issue || issue.local) return;
      event.preventDefault();
      selectedIssueIds = new Set([issue.id]);
      selectionAnchorId = issue.id;
      return;
    }
    // 다중 선택 중: ↑/↓로 이동하고 Enter/Space로 선택을 뒤집는다.
    if (selectionMode && canNavigate && hasNoInteractiveFocus()) {
      if (plainKey && direction) {
        event.preventDefault();
        moveNoteRowFocus(direction);
        return;
      }
      if (freshPlainKey && ['Enter', ' '].includes(event.key)) {
        const issue = keyboardFocusedListIssue();
        if (!issue) return;
        event.preventDefault();
        toggleIssueSelection(issue);
        return;
      }
    }
    // Delete/Backspace: 선택한(또는 포커스된) 노트를 휴지통으로 보낸다.
    if (state === 'open' && hasNoInteractiveFocus() && freshPlainKey && isDeleteShortcut(event)) {
      const targets = keyboardDeletionTargets();
      if (targets.length > 0) {
        event.preventDefault();
        moveIssues(targets);
        return;
      }
    }
    if (!canUseShortcuts || !freshPlainKey) return;
    // 1~9: 등록 순서의 저장소로 전환한다.
    const workspaceNumber = workspaceNumberFromEvent(event);
    if (hasNoInteractiveFocus() && !event.isComposing && workspaceNumber) {
      const workspace = workspaces[workspaceNumber - 1];
      if (!workspace) return;
      event.preventDefault();
      switchWorkspace(workspace.id);
      return;
    }
    // Enter: 목록 행이면 열고, 이미 키보드로 연 노트면 편집으로 들어간다.
    if (event.key === 'Enter' && isNoteRowButton(activeElement)) {
      const issueId = activeElement.dataset.issueId;
      const issue = [...pinnedIssues, ...unpinnedVisibleIssues].find((item) => String(item.id) === issueId);
      if (!issue) return;
      event.preventDefault();
      if (keyboardEnteredIssueId === issueId) {
        editorFocusRequest += 1;
        return;
      }
      keyboardEnteredIssueId = issueId;
      // 열람으로 들어갈 때는 목록 행의 실제 포커스를 해제한다. 점선은 별도 상태로 유지된다.
      activeElement.blur?.();
      selectNote(issue);
      return;
    }
    if (event.key === 'Enter' && isKeyboardEnteredNoteSelection() && isContentRoute(contentRoute)) {
      event.preventDefault();
      editorFocusRequest += 1;
      return;
    }
    // ↑/↓: 목록 행 사이를 이동한다.
    if (direction && hasNoInteractiveFocus()) {
      event.preventDefault();
      moveNoteRowFocus(direction);
      return;
    }
    // N: 새 노트를 만든다.
    if (hasNoInteractiveFocus() && !event.isComposing && isNewNoteShortcut(event)) {
      event.preventDefault();
      newNote();
    }
  }

  function canUseListKeyboardShortcuts() {
    return !selectionMode && canUseKeyboardListNavigation();
  }

  function canUseKeyboardListNavigation() {
    const isHomeOrNote = routeStack.length === 0
      || contentRoute?.screen === 'note'
      || isHomeOrNoteHash(window.location.hash);
    return (
      appState === 'ready'
      && topRoute?.screen !== 'settings'
      && !workspaceWizardOpen
      && !helpTopic
      && isHomeOrNote
    );
  }

  function hasNoInteractiveFocus() {
    return !isFormControl(document.activeElement);
  }

  function isKeyboardEnteredNoteSelection() {
    return document.activeElement === document.body
      && Boolean(keyboardFocusedIssueId)
      && keyboardEnteredIssueId === keyboardFocusedIssueId;
  }

  function keyboardFocusedListIssue() {
    return [...pinnedIssues, ...unpinnedVisibleIssues]
      .find((issue) => String(issue.id) === keyboardFocusedIssueId);
  }

  function noteRowButtons() {
    return noteList?.rowButtons() || [];
  }

  function moveNoteRowFocus(direction) {
    const buttons = noteRowButtons();
    if (!buttons.length) return;

    const focusedIndex = buttons.indexOf(document.activeElement);
    let targetIndex = focusedIndex;
    if (targetIndex === -1) {
      // 상세 화면을 나와 DOM 포커스가 body로 돌아가도, 목록에 남은 키보드
      // 커서 표시를 기준으로 다음 행을 계산한다.
      const keyboardFocusedIndex = buttons.findIndex(
        (button) => button.dataset.issueId === keyboardFocusedIssueId
      );
      if (keyboardFocusedIndex !== -1) {
        targetIndex = keyboardFocusedIndex + direction;
      } else {
        const lastOpenedIssueId = lastOpenedIssueIds.get(activeWorkspaceId);
        const lastOpenedIndex = buttons.findIndex((button) => button.dataset.issueId === String(lastOpenedIssueId));
        if (lastOpenedIndex !== -1) {
          targetIndex = lastOpenedIndex + direction;
        } else {
          const containerBounds = noteList.viewportBounds();
          targetIndex = buttons.findIndex((button) => {
            const bounds = button.getBoundingClientRect();
            return bounds.bottom > containerBounds.top && bounds.top < containerBounds.bottom;
          });
        }
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

    selectedIssueIds = rangeSelection(orderedIssues, anchorIndex, targetIndex);

    const target = buttons[targetIndex];
    keyboardFocusedIssueId = target.dataset.issueId || '';
    keyboardEnteredIssueId = '';
    target.scrollIntoView({ block: 'nearest' });
    target.focus({ preventScroll: true });
  }

  function handleGlobalPaste(event) {
    if (mergeBusy) {
      event.preventDefault();
      return;
    }
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
    synchronizeKeyboardFocusWithDetail(issue);
    if (!issue.local) {
      refreshingIssueNumber = issue.number;
      issueRefreshRequests = { [issue.number]: ++issueRefreshSequence };
    }
    router.navigate(issue.local ? 'new' : `note.${issue.number}`);
  }

  function beginIssueLongPress(event, issue) {
    if (selectionMode || issue.local || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    longPress.begin(event, issue);
  }

  function selectIssueByLongPress(issue) {
    selectedIssueIds = new Set([issue.id]);
    selectionAnchorId = issue.id;
    keyboardFocusedIssueId = String(issue.id);
    keyboardEnteredIssueId = '';
    navigator.vibrate?.(20);
    previewSelectedIssue(issue);
  }

  function handleIssueContextMenu(event, issue) {
    if (selectionMode || longPress.isSuppressed(issue)) event.preventDefault();
  }

  function handleIssueClick(event, issue) {
    if (longPress.consumeClick(issue)) {
      event.preventDefault();
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
    if ((event.ctrlKey || event.metaKey) && !issue.local) {
      event.preventDefault();
      const keyboardFocusedIssue = visibleIssues
        .find((item) => String(item.id) === keyboardFocusedIssueId);
      if (keyboardFocusedIssue && !keyboardFocusedIssue.local && keyboardFocusedIssue.id !== issue.id) {
        selectedIssueIds = new Set([keyboardFocusedIssue.id]);
        selectionAnchorId = keyboardFocusedIssue.id;
      }
      if (toggleIssueSelection(issue)) previewSelectedIssue(issue);
      return;
    }
    selectNote(issue);
  }

  function toggleIssueSelection(issue, selectRange = false) {
    if (issue.local) return false;
    // 마우스 선택 뒤에도 이후 키보드 조작의 기준은 마지막으로 고른 항목이다.
    keyboardFocusedIssueId = String(issue.id);
    keyboardEnteredIssueId = '';
    const next = toggleSelection({
      selectedIds: selectedIssueIds,
      anchorId: selectionAnchorId,
      issues: visibleIssues,
      issue,
      range: selectRange
    });
    selectedIssueIds = next.selectedIds;
    selectionAnchorId = next.anchorId;
    return next.selected;
  }

  function handleIssueSelectionClick(event, issue) {
    if (toggleIssueSelection(issue, event.shiftKey)) previewSelectedIssue(issue);
  }

  function previewSelectedIssue(issue) {
    if (!matchMedia('(min-width: 992px)').matches) return;
    selectNote(issue);
  }

  function clearIssueSelection() {
    longPress.cancel();
    longPress.clearSuppression();
    closeSelectionTagPanel();
    selectedIssueIds = new Set();
    selectionAnchorId = null;
  }

  function reconcileIssueSelection(nextIssues) {
    const next = reconcileSelection({ selectedIds: selectedIssueIds, anchorId: selectionAnchorId, issues: nextIssues });
    if (!next) return;
    selectedIssueIds = next.selectedIds;
    selectionAnchorId = next.anchorId;
  }

  function keyboardDeletionTargets() {
    if (selectedIssues.length) return selectedIssues;
    const focusedIssue = [...pinnedIssues, ...unpinnedVisibleIssues]
      .find((issue) => String(issue.id) === keyboardFocusedIssueId);
    return focusedIssue && !focusedIssue.local ? [focusedIssue] : [];
  }

  // 유예가 끝난 휴지통 이동을 실행한다. 편집 중이던 노트는 저장이 끝난 뒤에만 옮긴다.
  async function runPendingIssueDeletion(entry) {
    let saved = true;
    try {
      saved = entry.savePromise ? await entry.savePromise : true;
    } catch {
      saved = false;
    }
    if (!saved) {
      deletionQueue.remove(entry.id);
      error = $_('m.3a743b0e61');
      return;
    }
    moveIssuesImmediately(entry.issues, { deletionEntryId: entry.id, nextState: entry.nextState });
  }

  function moveIssues(issuesToMove, { savePromise = null } = {}) {
    if (!issuesToMove?.length) {
      clearIssueSelection();
      return;
    }
    if (state === 'open') {
      // 이미 대기열에 든 항목은 다시 넣지 않는다. 나머지는 각각 독립적인
      // 3초 유예를 가지므로 Delete를 연달아 눌러도 모두 접수된다.
      if (!deletionQueue.enqueue(issuesToMove, { nextState: 'closed', savePromise })) return;
      clearIssueSelection();
      return;
    }
    moveIssuesImmediately(issuesToMove);
  }

  function moveIssuesImmediately(issuesToMove, { deletionEntryId = null, nextState = state === 'open' ? 'closed' : 'open' } = {}) {
    const movedIssues = issuesToMove;
    clearIssueSelection();
    for (const issue of movedIssues) {
      moveIssue(issue, nextState, { deletionEntryId });
    }
  }

  function closeSelectionTagPanel() {
    selectionTagPanelOpen = false;
  }

  function toggleSelectionTagPanel() {
    if (selectionTagPanelOpen) closeSelectionTagPanel();
    else selectionTagPanelOpen = true;
  }

  async function applySelectionTag(name, mode) {
    // 새 태그 이름만 정규화 대상이라, 공백이 들어간 기존 라벨 이름은 그대로 쓴다.
    const tagName = String(name || '').trim();
    if (!tagName || isPinLabel(tagName) || selectionTagBusy) return;
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
        const updatedIssue = { ...issue, labels: savedLabels };
        const displayedIssue = syncPinnedIssue(updatedIssue);
        refreshed[issue.number] = ++issueRefreshSequence;
        issues = issues.map((item) => item.id === issue.id ? displayedIssue : item);
        if (selectedIssue?.id === issue.id) selectedIssue = displayedIssue;
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

  async function mergeSelectedIssues() {
    const sources = [...selectedIssues];
    if (mergeBusy || state !== 'open' || sources.length < 2) return;

    error = '';
    notice = '';
    mergeBusy = true;
    try {
      const { mergedIssue, closedSourceIds, closeFailures } = await mergeIssues(token, repo, sources);
      invalidateCachedIssueList(activeWorkspaceId);
      clearIssueSelection();
      // GitHub 검색 인덱스나 목록 요청이 잠시 늦어도, 성공적으로 닫은 원본을
      // 현재 화면에 다시 남겨 두지 않는다. 저장한 병합 이슈도 즉시 표시한다.
      issues = [mergedIssue, ...issues.filter((issue) => !closedSourceIds.has(issue.id))];
      pinnedIssues = pinnedIssues.filter((issue) => !closedSourceIds.has(issue.id));
      // 병합 전 목록을 이어 붙이면, 두 번째 페이지부터 남아 있던 원본이 열린
      // 목록에 다시 나타날 수 있다. 전체 목록을 다시 읽어 닫힌 원본을 확실히 제거한다.
      await loadIssues();
      router.navigate(`/note.${mergedIssue.number}`);
      if (closeFailures.length) {
        error = $_('dynamic.mergeCloseFailed', { values: { numbers: closeFailures.map((number) => `#${number}`).join(', ') } });
      } else {
        notice = $_('dynamic.mergeComplete', { values: { number: mergedIssue.number } });
      }
    } catch (reason) {
      const cause = reason instanceof MergeError ? reason.cause : reason;
      error = reason?.draftNumber
        ? $_('dynamic.mergeFailedWithDraft', { values: { number: reason.draftNumber, error: friendlyError(cause) } })
        : $_('dynamic.mergeFailed', { values: { error: friendlyError(cause) } });
    } finally {
      mergeBusy = false;
    }
  }

  function noteRefreshStateChanged(issueNumber, active) {
    if (active) refreshingIssueNumber = issueNumber;
    else if (refreshingIssueNumber === issueNumber) refreshingIssueNumber = null;
  }

  function noteSaved(savedIssue, localDraft = null) {
    if (state === 'open' && savedIssue.state === 'closed') {
      removeClosedIssueFromOpenView(savedIssue);
      return;
    }
    const savedDisplayedIssue = localDraft ? { ...savedIssue, ...localDraft } : savedIssue;
    const displayedIssue = syncPinnedIssue(savedDisplayedIssue);
    issues = issues.map((issue) => issue.id === savedIssue.id ? displayedIssue : issue);
    const savedIssueIsActive = contentRoute?.screen === 'note'
      && Number(contentRoute.value) === savedIssue.number;
    // 저장 응답보다 새 입력이 먼저 들어온 경우(localDraft가 존재함)에는
    // 활성 편집기에 새 issue 객체를 다시 전달하지 않는다. 편집기 로컬
    // 상태가 최신이므로, 이 객체 교체가 caret/스크롤 보정을 재발시키지
    // 않도록 저장 목록만 갱신한다.
    if (savedIssueIsActive && !localDraft) selectedIssue = displayedIssue;
    if (savedIssueIsActive && activeLabel && !hasIssueLabel(displayedIssue, activeLabel)) {
      router.navigate(`/note.${savedIssue.number}`);
    }
  }

  function noteRefreshed(refreshedIssue) {
    if (state === 'open' && refreshedIssue.state === 'closed') {
      removeClosedIssueFromOpenView(refreshedIssue);
      return;
    }
    const displayedIssue = syncPinnedIssue(refreshedIssue);
    issues = issues.map((issue) => issue.id === refreshedIssue.id ? displayedIssue : issue);
    const refreshedIssueIsActive = contentRoute?.screen === 'note'
      && Number(contentRoute.value) === refreshedIssue.number;
    if (refreshedIssueIsActive) selectedIssue = displayedIssue;
  }

  function removeClosedIssueFromOpenView(closedIssue) {
    const removedFromIssues = issues.some((issue) => issue.id === closedIssue.id);
    const removedPinnedIndex = pinnedIssues.findIndex((issue) => issue.id === closedIssue.id);
    if (!removedFromIssues && removedPinnedIndex < 0) return;

    issueListMutationVersion += 1;
    issues = issues.filter((issue) => issue.id !== closedIssue.id);
    if (removedPinnedIndex >= 0) {
      pinnedIssues = pinnedIssues.filter((issue) => issue.id !== closedIssue.id);
    }
    totalIssues = Math.max(0, totalIssues - 1);
    adjustWorkspaceNoteCount(activeWorkspaceId, -1);

    if (selectedIssue?.id === closedIssue.id) {
      selectedIssue = null;
      if (router.getDepth()) router.popTo(0);
    }
  }

  function syncPinnedIssue(issue) {
    if (!issue) return;
    const pendingPin = pendingPinMutationFor(activeWorkspaceId, token, repo);
    const syncedIssue = applyPendingPin(issue, pendingPin);
    pinnedIssues = syncPinnedList(pinnedIssues, syncedIssue);
    return syncedIssue;
  }

  async function togglePin(issue) {
    if (!issue?.number || issue.local || pinBusyIssueNumber !== null) return;
    const currentlyPinned = pinnedIssues.some((item) => samePinIssue(item, issue)) || hasPinLabel(issue);
    const requestedWorkspaceId = activeWorkspaceId;
    const requestedToken = token;
    const requestedRepo = repo;
    const mutation = {
      id: ++nextPinMutationId,
      workspaceId: requestedWorkspaceId,
      token: requestedToken,
      repo: requestedRepo,
      issue,
      desiredPinned: !currentlyPinned,
      wasPinned: currentlyPinned,
      previousPinnedIssue: pinnedIssues.find((item) => samePinIssue(item, issue)) || null,
      shouldCreatePinLabel: !repositoryLabels.some((label) => isPinLabel(label))
    };
    mutation.optimisticIssue = withPinState(issue, mutation.desiredPinned);
    pendingPinMutation = mutation;
    pinBusyIssueNumber = issue.number;
    error = '';
    // 서버 응답을 기다리지 않고 먼저 화면과 편집기 양쪽의 이슈 모델을 바꾼다.
    applyPinIssue(mutation.optimisticIssue);
    try {
      let savedLabels;
      if (currentlyPinned) {
        try {
          savedLabels = await removeIssueLabel(
            requestedToken,
            requestedRepo,
            issue.number,
            PIN_LABEL_NAME
          );
        } catch (reason) {
          // 다른 디바이스에서 먼저 해제한 경우도 최종 상태는 "해제"다.
          if (reason?.status !== 404) throw reason;
          savedLabels = mutation.optimisticIssue.labels;
        }
      } else {
        if (mutation.shouldCreatePinLabel) {
          const createdLabel = await createLabel(requestedToken, requestedRepo, PIN_LABEL_NAME);
          if (pinMutationMatchesContext(mutation)) mergeRepositoryLabels([createdLabel]);
        }
        savedLabels = await addIssueLabel(
          requestedToken,
          requestedRepo,
          issue.number,
          PIN_LABEL_NAME
        );
      }
      if (!pinMutationMatchesContext(mutation)) return;
      const currentIssue = currentIssueForPinMutation(mutation);
      const updatedIssue = {
        ...currentIssue,
        labels: Array.isArray(savedLabels)
          ? savedLabels
          : mutation.optimisticIssue.labels
      };
      applyPinIssue(updatedIssue);
    } catch (reason) {
      if (!pinMutationMatchesContext(mutation)) return;
      restorePinMutation(mutation);
      error = friendlyError(reason);
    } finally {
      if (pendingPinMutation?.id === mutation.id) {
        pendingPinMutation = null;
        pinBusyIssueNumber = null;
      }
    }
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
    adjustWorkspaceNoteCount(activeWorkspaceId, 1);
    pendingNote = null;
    pendingAllocation = null;
    if (newNoteIsActive) {
      selectedIssue = savedIssue;
      synchronizeKeyboardFocusWithDetail(savedIssue);
    }
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
      router.navigate(`/${segmentsWithPromotedNote(routeStack, savedIssue.number).join('/')}`);
    }
  }

  function noteDraftChanged(sourceIssue, draft) {
    if (!sourceIssue) {
      if (!pendingNote) return;
      pendingNote = { ...pendingNote, ...draft };
      if (isPendingNoteRoute(contentRoute)) selectedIssue = pendingNote;
      return;
    }

    const updatedIssue = { ...sourceIssue, ...draft };
    const displayedIssue = syncPinnedIssue(updatedIssue);
    issues = issues.map((issue) => issue.id === sourceIssue.id ? displayedIssue : issue);
  }

  function mergeRepositoryLabels(nextLabels) {
    repositoryLabels = mergeLabels(repositoryLabels, nextLabels, $activeLocale);
  }

  function rewriteActiveTagRoute(nextName = '') {
    const nextSegments = segmentsWithRenamedTag(routeStack, nextName);
    settingsRouteOverride = nextSegments.join('/');
    router.navigate(`/${[...nextSegments, 'settings'].join('/')}`);
  }

  // 저장소 태그 이름이 바뀌거나(nextName) 지워지면 화면의 노트·초안과 열린 편집기에 반영한다.
  function applyLabelChangeToNotes(connectedRepo, currentName, nextName = '') {
    issues = issues.map((issue) => replaceIssueLabel(issue, currentName, nextName));
    pinnedIssues = pinnedIssues.map((issue) => replaceIssueLabel(issue, currentName, nextName));
    pendingNote = replaceIssueLabel(pendingNote, currentName, nextName);
    selectedIssue = replaceIssueLabel(selectedIssue, currentName, nextName);
    renameDraftLabels(connectedRepo, currentName, nextName);
    labelMutation = { id: ++labelMutationSequence, from: currentName, to: nextName };
  }

  async function renameRepositoryLabel(label, nextTag) {
    const { name: normalizedName, description: normalizedDescription } = limitTagInput(nextTag);
    if (isPinLabel(label) || !normalizedName || isPinLabel(normalizedName)) {
      error = $_('dynamic.tagNameRequired', { values: { name: label.name } });
      return false;
    }
    if (normalizedName === label.name && normalizedDescription === String(label.description || '').trim()) return true;
    const labelKey = String(label.id || label.name).toLocaleLowerCase();
    labelBusy = { ...labelBusy, [labelKey]: true };
    const previous = labelRenameQueues.get(labelKey) || Promise.resolve();
    const queued = previous.catch(() => false).then(async () => {
      const currentLabel = repositoryLabels.find((item) => String(item.id || item.name).toLocaleLowerCase() === labelKey) || label;
      error = '';
      try {
        const connectedRepo = repository?.full_name || repo;
        const savedLabel = await renameLabel(token, connectedRepo, currentLabel.name, normalizedName, normalizedDescription);
        repositoryLabels = sortLabels(
          repositoryLabels.map((item) => item.name === currentLabel.name ? savedLabel : item),
          $activeLocale
        );
        applyLabelChangeToNotes(connectedRepo, currentLabel.name, savedLabel.name);
        if (currentLabel.name !== savedLabel.name) {
          notice = $_('dynamic.tagRenamed', { values: { from: currentLabel.name, to: savedLabel.name } });
          if (activeLabel.toLocaleLowerCase() === currentLabel.name.toLocaleLowerCase()) rewriteActiveTagRoute(savedLabel.name);
        }
        return true;
      } catch (reason) {
        error = friendlyError(reason);
        return false;
      }
    });
    labelRenameQueues.set(labelKey, queued);
    void queued.finally(() => {
      if (labelRenameQueues.get(labelKey) !== queued) return;
      labelRenameQueues.delete(labelKey);
      const { [labelKey]: completed, ...remaining } = labelBusy;
      labelBusy = remaining;
    });
    return queued;
  }

  // 환경설정은 화면을 벗어날 때(닫기·뒤로) 한 번에 확정한다.
  function applySettingsChanges() {
    if (appState !== 'ready') return;
    preferences = finalizePreferences(preferences);
    applyTheme(preferences.theme);
    const preferencesChanged = preferenceSignature(preferences) !== settingsEntrySignature;
    // 전사 단어는 다른 기기와 공유하는 저장소 설정이므로, 환경설정을 닫을 때
    // 한 번만 저장한다. 태그 변경처럼 매번 즉시 저장할 필요는 없다.
    void transcriptionHints.flush();
    // 그냥 들여다보기만 하고 나온 경우에는 저장도 알림도 하지 않는다.
    if (!preferencesChanged) return;
    persistSettings(repo);
    // 유지 시간을 바꾸면 이미 열려 있는 잠금 세션도 새 길이로 다시 센다.
    if (lockPin) setLockSession(lockPin);
    // 페이지 크기는 목록 요청에 그대로 들어가므로, 바뀌었으면 다시 불러온다.
    if (preferences.issuePageSize !== settingsEntryPageSize) loadIssues();
    settingsEntryPageSize = preferences.issuePageSize;
    settingsEntrySignature = preferenceSignature(preferences);
  }

  function announceDeferredApply() {
    toast.show($_("m.be71371eed"));
  }

  async function createRepositoryLabel(tag) {
    if (labelBusy.creating) return;
    const { name: normalizedName, description: normalizedDescription } = limitTagInput(tag);
    if (!normalizedName || isPinLabel(normalizedName)) return;
    labelBusy = { ...labelBusy, creating: true };
    error = '';
    try {
      const connectedRepo = repository?.full_name || repo;
      const savedLabel = await createLabel(token, connectedRepo, normalizedName, { description: normalizedDescription });
      mergeRepositoryLabels([savedLabel]);
      notice = $_('dynamic.tagAdded', { values: { name: savedLabel.name } });
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      const { creating, ...remaining } = labelBusy;
      labelBusy = remaining;
    }
  }

  async function deleteRepositoryLabel(label) {
    const labelKey = String(label.id || label.name).toLocaleLowerCase();
    if (labelBusy[labelKey] || isPinLabel(label)) return;
    if (!confirm($_('dynamic.deleteTagConfirm', { values: { name: label.name } }))) return;
    labelBusy = { ...labelBusy, [labelKey]: true };
    error = '';
    try {
      const connectedRepo = repository?.full_name || repo;
      await removeLabel(token, connectedRepo, label.name);
      repositoryLabels = repositoryLabels.filter((item) => item.name !== label.name);
      applyLabelChangeToNotes(connectedRepo, label.name);
      notice = $_('dynamic.tagDeleted', { values: { name: label.name } });
      if (activeLabel.toLocaleLowerCase() === label.name.toLocaleLowerCase()) rewriteActiveTagRoute();
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      const { [labelKey]: completed, ...remaining } = labelBusy;
      labelBusy = remaining;
    }
  }

  function openLabel(labelName) {
    query = `#${labelName}`;
    appliedQuery = query;
    selectedIssue = null;
    const route = tagRouteSegment(labelName);
    if (hasScreen(routeStack, 'tag')) router.navigate(route);
    else if (isContentRoute(topRoute)) router.navigate(`/${route}`);
    else router.push(route);
  }

  function clearLabel() {
    if (topRoute?.screen === 'tag') router.pop();
    else router.navigate('/');
  }

  async function moveIssue(issue, nextState, { deletionEntryId = null } = {}) {
    error = '';
    const requestedWorkspaceId = activeWorkspaceId;
    const requestedToken = token;
    const requestedRepo = repo;
    const requestedState = state;
    const requestedQuery = appliedQuery;
    const requestedLabel = activeLabel;
    const noteCountDelta = nextState === 'open' ? 1 : -1;
    const shouldSettlePendingDeletion = nextState === 'closed'
      && deletionEntryId !== null
      && deletionQueue.isInFlight(deletionEntryId, issue.id);
    const isCurrentContext = () => requestedWorkspaceId === activeWorkspaceId
      && requestedToken === token
      && requestedRepo === repo
      && requestedState === state
      && requestedQuery === appliedQuery
      && requestedLabel === activeLabel;
    try {
      await setIssueState(requestedToken, requestedRepo, issue.number, nextState);
      invalidateCachedIssueList(requestedWorkspaceId);
      if (!isCurrentContext()) return;

      issueListMutationVersion += 1;

      const removedPinnedIssue = pinnedIssues.find((item) => item.id === issue.id);
      const wasSelected = selectedIssue?.id === issue.id;

      const transitionedIssue = { ...issue, state: nextState };
      issues = nextState === requestedState
        ? [transitionedIssue, ...issues.filter((item) => item.id !== issue.id)]
        : issues.filter((item) => item.id !== issue.id);
      if (removedPinnedIssue) {
        pinnedIssues = pinnedIssues.filter((item) => item.id !== issue.id);
      }
      totalIssues = Math.max(0, totalIssues + (nextState === requestedState ? 1 : -1));
      adjustWorkspaceNoteCount(requestedWorkspaceId, noteCountDelta);
      if (wasSelected) {
        selectedIssue = null;
        if (router.getDepth()) router.popTo(0);
      }
      if (nextState === 'open' && hasPinLabel(issue)) {
        syncPinnedIssue({ ...issue, state: 'open' });
      }
      if (nextState === 'open') {
        const restoredIssue = transitionedIssue;
        pendingRestoredIssues = [
          restoredIssue,
          ...pendingRestoredIssues.filter((item) => item.id !== restoredIssue.id)
        ];
      } else {
        pendingTrashedIssues = [
          transitionedIssue,
          ...pendingTrashedIssues.filter((item) => item.id !== transitionedIssue.id)
        ];
      }
      notice = nextState === 'closed'
        ? ''
        : $_("m.a480a954e7");
    } catch (reason) {
      if (isCurrentContext()) error = friendlyError(reason);
    } finally {
      if (shouldSettlePendingDeletion) deletionQueue.settle(deletionEntryId, issue.id);
    }
  }

  function openSettings() {
    clearIssueSelection();
    settingsRouteOverride = '';
    settingsEntryPageSize = preferences.issuePageSize;
    settingsEntrySignature = preferenceSignature(preferences);
    error = '';
    notice = '';
    // 환경설정을 열 때는 다른 기기에서 바꾼 용어집도 즉시 반영한다.
    void transcriptionHints.load(true);
    router.push('settings');
  }

  async function openVoiceRecording(issue = null, target = { type: 'body' }) {
    if (pendingNote || selectionMode) return;
    if (!voiceApiKey.trim()) {
      alert('음성 녹음을 사용하려면 OpenAI API 키를 발급한 뒤 환경설정의 음성 API 키에 지정하세요. 해당 설정으로 이동합니다.');
      openVoiceAfterSettings = true;
      focusVoiceSettingsAfterOpen = true;
      openSettings();
      return;
    }
    // 녹음 진입 시에는 현재 저장소의 용어집을 한 번만 읽는다. 이후 녹음은
    // 메모리에 둔 값을 쓰므로 전사할 때마다 GitHub 요청을 보내지 않는다.
    await transcriptionHints.load();
    beginVoiceRecording({ ...target, issueNumber: issue?.number || null });
  }

  function beginVoiceRecording(destination) {
    voiceRecordingDestination = destination;
    voiceHasUnrecordedAudio = false;
    allowVoiceRouteExit = false;
    router.push('voice');
  }

  function blurFocusedTextControl() {
    const active = document.activeElement;
    if (isTextControl(active)) active.blur();
  }

  function blurForEdgeBackSwipe(event) {
    if (!touchDevice || event.touches?.[0]?.clientX > 24) return;
    blurFocusedTextControl();
  }

  async function focusVoiceSettings() {
    await tick();
    await voiceSettings?.focusApiKey();
  }

  async function recordVoiceNote(body, audio, selectedTags = [], suggestedTitle = '') {
    const normalizedBody = normalizeVoiceParagraphs(body);
    const normalizedSuggestedTitle = normalizeSuggestedTitle(suggestedTitle);
    const selectedTagNames = knownTagNames(selectedTags, visibleRepositoryLabels);
    const requestedWorkspaceId = activeWorkspaceId;
    const requestedToken = token;
    const requestedRepo = repo;
    const destination = voiceRecordingDestination;
    const attachment = preserveOriginalVoiceAudio && destination?.issueNumber
      ? await uploadVoiceAttachment(audio, requestedToken, requestedRepo, destination.issueNumber)
      : null;
    voiceRecordingDestination = null;
    if (destination?.type === 'body' && destination.issueNumber) {
      voiceBody = {
        id: ++voiceBodySequence, ...destination, body: normalizedBody, attachment,
        selectedTags: selectedTagNames, suggestedTitle: normalizedSuggestedTitle
      };
      allowVoiceRouteExit = true;
      router.pop();
      return;
    }
    if (destination?.type === 'comment-edit' && destination.issueNumber) {
      await Promise.all(selectedTagNames.map((name) => addIssueLabel(requestedToken, requestedRepo, destination.issueNumber, name)));
      voiceCommentEdit = { id: ++voiceCommentEditSequence, ...destination, body: normalizedBody, attachmentLink: voiceAttachmentLink(requestedRepo, attachment) };
      allowVoiceRouteExit = true;
      router.pop();
      return;
    }
    if (destination?.type === 'comment-new' && destination.issueNumber) {
      await Promise.all(selectedTagNames.map((name) => addIssueLabel(requestedToken, requestedRepo, destination.issueNumber, name)));
      // 태그 분류 발화만 한 경우 빈 댓글을 만들지 않고, 부모 이슈의 태그만 갱신한다.
      if (!normalizedBody && !attachment) {
        allowVoiceRouteExit = true;
        router.pop();
        return;
      }
      const comment = await createIssueComment(requestedToken, requestedRepo, destination.issueNumber, appendVoiceAttachmentLink(normalizedBody, requestedRepo, attachment));
      if (requestedWorkspaceId !== activeWorkspaceId || requestedToken !== token || requestedRepo !== repo) return;
      voiceComment = { id: ++voiceCommentSequence, issueNumber: destination.issueNumber, comment };
      allowVoiceRouteExit = true;
      router.pop();
      return;
    }
    const { title, body: issueBody } = composeVoiceIssue({
      titleMode: preferences.titleMode,
      body: normalizedBody,
      suggestedTitle: normalizedSuggestedTitle
    });
    const created = await createIssue(requestedToken, requestedRepo, { title, body: issueBody, labels: selectedTagNames });
    if (preserveOriginalVoiceAudio) await uploadVoiceAttachment(audio, requestedToken, requestedRepo, created.number);
    if (requestedWorkspaceId !== activeWorkspaceId || requestedToken !== token || requestedRepo !== repo) return;
    invalidateCachedIssueList(activeWorkspaceId);
    state = 'open';
    query = '';
    appliedQuery = '';
    activeLabel = '';
    issues = [created, ...issues.filter((issue) => issue.id !== created.id)];
    totalIssues += 1;
    adjustWorkspaceNoteCount(activeWorkspaceId, 1);
    // 새 이슈로 이동하면서 음성 경로를 닫는다. VoiceRecorder가 이미 dirty
    // 상태를 해제하지만, 비동기 렌더 순서에도 안전하도록 완료 이탈임을 명시한다.
    allowVoiceRouteExit = true;
    router.navigate(`/note.${created.number}`);
  }

  async function uploadVoiceAttachment(audio, requestedToken, requestedRepo, issueNumber) {
    if (!audio) return null;
    return uploadAttachment(requestedToken, requestedRepo, issueNumber, voiceAudioFile(audio));
  }

  function voiceBodyHandled(id) {
    if (voiceBody?.id === id) voiceBody = null;
  }

  function closeSettings() {
    router.pop();
  }

  function openHelp(topic) {
    if (!HELP_TOPICS.has(topic)) return;
    router.push(`help.${topic}`);
  }

  function closeHelp() {
    if (topRoute?.screen === 'help') router.pop();
  }

  async function copyMcpText(value, successMessage) {
    try {
      await navigator.clipboard.writeText(value);
      toast.show(successMessage);
    } catch {
      toast.show($_("m.da21b2386d"));
    }
  }

</script>

{#if (appState === 'booting' || appState === 'restoring') && topRoute?.screen !== 'settings'}
  <main class="boot-screen">
    <img class="brand-mark brand-mark-sm" src="./icon.svg" alt="" />
    <span class="boot-loading-message text-secondary small">
      {appState === 'restoring' ? $_("m.dc21c1787a") : $_("m.e5f58095ac")}
      <BrailleSpinner active />
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
        <div class="col-12 bg-white p-3 p-md-5">
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
                  tagLabels={visibleRepositoryLabels}
                  tagBusy={labelBusy}
                  onCreateTag={createRepositoryLabel}
                  onRenameTag={renameRepositoryLabel}
                  onDeleteTag={deleteRepositoryLabel}
                />
              </div>
            {/if}

            <DisplaySettings bind:preferences onDeferredChange={announceDeferredApply} />

              <VoiceSettings
                bind:this={voiceSettings}
                bind:apiKey={voiceApiKey}
                bind:refinementPrompt={voiceRefinementPrompt}
                bind:transcriptionModel={voiceTranscriptionModel}
                bind:refinementModel={voiceRefinementModel}
                bind:preserveOriginalAudio={preserveOriginalVoiceAudio}
                transcriptionHints={$transcriptionHints.value}
                hintsLoading={$transcriptionHints.loading}
                hintsError={$transcriptionHints.error}
                onHintsInput={transcriptionHints.stage}
              />

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
    {#if $toast}
      <div class="app-toast" role="status">{$toast}</div>
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
          </div>
          <button
            class="btn btn-outline-secondary responsive-toolbar-button sidebar-settings-button"
            class:is-hidden={selectionMode}
            on:click={openSettings}
          >
            <i class="bi bi-gear" aria-hidden="true"></i> {$_('settings.sidebarLabel')}
          </button>
          <SelectionToolbar
            active={selectionMode}
            {state}
            selectedCount={selectedIssues.length}
            tagPanelOpen={selectionTagPanelOpen}
            busy={mergeBusy || selectionTagBusy || $deletionQueue.length > 0}
            onToggleTags={toggleSelectionTagPanel}
            onMerge={mergeSelectedIssues}
            onMove={() => moveIssues(selectedIssues)}
            onCancel={clearIssueSelection}
          />
        </div>

        {#if selectionMode && selectionTagPanelOpen}
          <SelectionTagPanel
            labels={visibleRepositoryLabels}
            {selectedIssues}
            busy={selectionTagBusy}
            onApply={applySelectionTag}
          />
        {/if}

        {#if error}
          <div class="sidebar-message text-danger">{error}</div>
        {/if}

        <NoteList
          bind:this={noteList}
          bind:query
          {state}
          labels={visibleRepositoryLabels}
          {loading}
          {loadingMore}
          hasMore={hasMoreIssues}
          {searchResultLimitReached}
          {selectionMode}
          {pinnedIssues}
          issues={unpinnedVisibleIssues}
          {emptyMessage}
          selectedIssueId={selectedIssue?.id}
          {keyboardFocusedIssueId}
          checkedIssueIds={selectedIssueIds}
          {refreshingIssueNumber}
          deletionEntries={$deletionQueue}
          listRowFields={preferences.listRowFields}
          newNoteDisabled={Boolean(pendingNote) || selectionMode}
          newNoteShortcutAvailable={canUseListKeyboardShortcuts() && !selectionMode && !pendingNote}
          voiceAvailable={Boolean(voiceApiKey.trim())}
          onChangeState={changeState}
          onSubmitSearch={submitSearch}
          onSelectLabel={selectSidebarLabel}
          onNewNote={newNote}
          onVoiceRecording={openVoiceRecording}
          onLoadMore={loadMoreIssues}
          onCancelDeletion={deletionQueue.cancel}
          rowHandlers={{
            pointerDown: beginIssueLongPress,
            pointerMove: longPress.track,
            pointerUp: longPress.finish,
            contextMenu: handleIssueContextMenu,
            click: handleIssueClick,
            selectionClick: handleIssueSelectionClick
          }}
        />
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
              titleMode={preferences.titleMode}
              font={preferences.editorFont}
              fontSize={preferences.editorFontSize}
              lineHeight={preferences.editorLineHeight}
              maxWidth={preferences.editorMaxWidth}
              autoSaveSeconds={preferences.autoSaveSeconds}
              {lockPin}
              lockSessionMinutes={preferences.lockSessionMinutes}
              onSetLockSession={setLockSession}
              currentUserLogin={user?.login || ''}
              paused={topRoute?.screen === 'settings' || topRoute?.screen === 'voice' || route !== contentRoute || selectionMode}
              readOnly={selectionMode}
              availableLabels={visibleRepositoryLabels}
              {labelMutation}
              pinned={Boolean(routeIssue) && (pinnedIssueIds.has(routeIssue.id) || hasPinLabel(routeIssue))}
              pinDisabled={pinBusyIssueNumber !== null}
              onTogglePin={(nextIssue) => togglePin(nextIssue || routeIssue)}
              onSaved={noteSaved}
              onRefreshed={noteRefreshed}
              onRefreshStateChange={(active) => noteRefreshStateChanged(routeIssue?.number, active)}
              onCreated={noteCreated}
              onDraftChange={(draft) => noteDraftChanged(routeIssue, draft)}
              onFileUploadRequested={queueExternalPaste}
              onExternalPasteHandled={externalPasteHandled}
              onLabelsAvailable={mergeRepositoryLabels}
              onTagSelect={openLabel}
              onMove={(issue, savePromise) => state === 'open'
                ? moveIssues([issue], { savePromise })
                : moveIssue(issue, 'open')}
              onVoiceRecording={(issue, target) => openVoiceRecording(issue, target)}
              voiceEnabled={Boolean(voiceApiKey.trim())}
              {voiceComment}
              {voiceBody}
              {voiceCommentEdit}
              onVoiceBodyHandled={voiceBodyHandled}
              onVoiceCommentEditHandled={(id) => { if (voiceCommentEdit?.id === id) voiceCommentEdit = null; }}
              onBack={() => router.pop()}
            />
            {#if state === 'open' && pendingIssueDeletionIds.has(routeIssue?.id)}
              {@const pendingDeletionEntry = findEntryForIssue($deletionQueue, routeIssue?.id)}
              <div class="note-deletion-overlay" role="status" aria-live="polite">
                <BrailleSpinner active />
                <span>{$_('dynamic.attachmentDeleting')}</span>
                <button
                  type="button"
                  class="note-deletion-cancel"
                  style:visibility={pendingDeletionEntry?.inFlight ? 'hidden' : 'visible'}
                  tabindex={pendingDeletionEntry?.inFlight ? -1 : undefined}
                  on:click={() => deletionQueue.cancel(pendingDeletionEntry?.id)}
                >{$_('setup.cancel')}</button>
              </div>
            {/if}
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
              <span class="help-sep" aria-hidden="true">|</span>
              <button type="button" class="help-link" on:click={() => openHelp('keyboard')}>{$_('help.buttonKeyboard')}</button>
            </div>
          </div>
        {/if}
      </section>
    </main>
    {#if mergeBusy}
      <div class="merge-progress-overlay" role="status" aria-live="assertive" aria-label={$_('dynamic.merging')}>
        <BrailleSpinner active />
        <span>{$_('dynamic.merging')}</span>
      </div>
    {/if}
  </div>
  {/if}
{/if}

{#if topRoute?.screen === 'voice'}
  <VoiceRecorder
    apiKey={voiceApiKey}
    refinementPrompt={voiceRefinementPrompt}
    transcriptionModel={voiceTranscriptionModel.trim() || DEFAULT_TRANSCRIPTION_MODEL}
    transcriptionLanguage={$activeLocale}
    transcriptionHints={$transcriptionHints.value}
    refinementModel={voiceRefinementModel.trim()}
    availableTags={visibleRepositoryLabels.map(({ name, description }) => ({ name, description }))}
    onComplete={recordVoiceNote}
    onDirtyChange={(dirty) => voiceHasUnrecordedAudio = dirty}
    onClose={() => { allowVoiceRouteExit = true; router.pop(); }}
  />
{/if}


{#if workspaceWizardOpen}
  <AddWorkspaceDialog onAdd={completeAddWorkspace} onClose={() => workspaceWizardOpen = false} />
{/if}

{#if helpTopic}
  <HelpOverlay
    topic={helpTopic}
    {mcpRepository}
    {mcpUsagePrompt}
    onCopy={copyMcpText}
    onClose={closeHelp}
  />
{/if}
