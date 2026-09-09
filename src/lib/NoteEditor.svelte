<script>
  import { afterUpdate, onDestroy, onMount, tick } from 'svelte';
  import Dropdown from 'bootstrap/js/dist/dropdown';
  import { tagColorForName } from './colors.js';
  import { _, locale } from 'svelte-i18n';
  import BrailleSpinner from './BrailleSpinner.svelte';
  import { externalLinkTarget } from './external-links.js';
  import { editorFontStack } from './editor-fonts.js';
  import { MAX_ISSUE_BODY_LENGTH, MAX_ISSUE_COMMENT_LENGTH } from './github-limits.js';
  import MarkdownViewer from './MarkdownViewer.svelte';
  import TagPicker from './TagPicker.svelte';
  import { automaticTitle, linkAtCursor, shortenMiddle } from './notes.js';
  import {
    composeAttachmentLink,
    compressAttachmentLinks,
    expandAttachmentLinks,
    insertAttachmentLinks,
    parseAttachmentPaths,
    removeAttachmentLink
  } from './attachments.js';
  import {
    addLockToTitle,
    decryptLockedBody,
    encryptLockedBody,
    isLockedPayload,
    isLockedTitle,
    normalizeLockPin,
    removeLockFromTitle
  } from './note-lock.js';
  import { isPinLabel, PIN_LABEL_NAME, visibleLabelNames, visibleLabels as filterVisibleLabels } from './pin-label.js';
  import {
    createIssue,
    createIssueComment,
    createLabel,
    deleteAttachment,
    deleteIssueComment,
    downloadAttachment,
    getIssue,
    listIssueAttachmentFiles,
    listIssueComments,
    updateIssue,
    updateIssueComment,
    uploadAttachment
  } from './github.js';

  export let token;
  export let repo;
  export let editorId = 'note';
  export let issue = null;
  export let initialDraft = null;
  export let ignoreRecoveredDraft = false;
  export let externalPasteRequest = null;
  export let refreshRequest = 0;
  export let justCreated = false;
  export let focusRequest = 0;
  export let allocationPromise = null;
  export let archived = false;
  export let titleMode = 'first-line';
  export let font = 'system';
  export let fontSize = 17;
  export let lineHeight = 1.8;
  export let maxWidth = 840;
  export let autoSaveSeconds = 5;
  export let paused = false;
  export let readOnly = false;
  export let availableLabels = [];
  export let labelMutation = null;
  export let onSaved = () => {};
  export let onCreated = () => {};
  export let onDraftChange = () => {};
  export let onExternalPasteHandled = () => {};
  export let onRefreshed = () => {};
  export let onRefreshStateChange = () => {};
  export let onLabelsAvailable = () => {};
  export let onMove = () => {};
  export let onBack = () => {};
  export let pinned = false;
  export let pinDisabled = false;
  export let onTogglePin = () => {};
  export let lockPin = '';
  export let lockSessionMinutes = 60;
  export let onSetLockSession = () => {};
  export let currentUserLogin = '';

  const DRAFTS_KEY = 'issue-note.drafts.v1';
  const MAX_ATTACHMENTS = 30;
  // 아직 번호가 없는 새 노트는 initialDraft.id(세션마다 고유)로 구분해야, 저장 도중
  // 리마운트되며 남겨진 이전 세션의 초안이 이후의 다른 새 노트에 잘못 복구되지 않는다.
  // 새로고침 직후처럼 initialDraft가 없을 때만 공용 'new' 키로 복구를 시도한다.
  const draftId = issue ? `issue.${issue.number}` : initialDraft?.id || 'new';
  const newContextTarget = externalLinkTarget();

  const initiallyLocked = isLockedTitle(issue?.title);
  let title = removeLockFromTitle(issue?.title || initialDraft?.title || '');
  let body = initiallyLocked ? issue?.body || '' : issue?.body || initialDraft?.body || '';
  let encryptedBody = initiallyLocked ? issue?.body || '' : '';
  let lockState = initiallyLocked ? 'locked' : 'plain';
  let activeLockPin = '';
  let lockPanelMode = '';
  let lockPanelPin = '';
  let lockPanelError = '';
  let lockPanelBusy = false;
  let lockSessionExpiring = false;
  let lockReuseTimer;
  let attachments = [];
  let orphanedAttachments = [];
  let attachmentsLoading = false;
  let remoteIssue = issue;
  let labels = (issue?.labels || initialDraft?.labels || []).map((label) => label.name);
  let dirty = false;
  let saving = false;
  let refreshing = false;
  let backgroundRefreshing = false;
  let uploading = 0;
  let uploadBatchActive = false;
  let deletingPath = '';
  let previewUrls = {};
  let viewerIndex = -1;
  let viewerElement;
  let editorScroll;
  let markdownViewer;
  let pendingPreviewScrollPosition = null;
  let previewMode = false;
  let appliedLabelMutation = 0;
  let revision = 0;
  let lastRemoteSignature = issue ? noteSignature({
    title: issue.title || '',
    body: issue.body || '',
    labels: (issue.labels || []).map((label) => label.name)
  }) : '';
  let activeSavingSignature = '';
  let forceSaveQueued = false;
  let forceSaveAllowPaused = false;
  let saveFailed = false;
  let draggingFiles = false;
  let reconciledIssueNumber = null;
  let destroyed = false;
  let wasPaused = paused;
  let comments = [];
  let loadingComments = Number(remoteIssue?.comments || 0) > 0;
  let commentsIssueNumber = null;
  let savingCommentIds = new Set();
  let commentSaveFailedIds = new Set();
  let dirtyCommentIds = new Set();
  let deletingCommentIds = new Set();
  let error = '';
  let localTimer;
  let remoteTimer;
  let fileInput;
  let bodyInput;
  let toolbarTagPicker;
  let moreToolbarElement;
  let issueLinkElement;
  let handledFocusRequest = 0;
  let mobileTagPicker;
  let inlineTagPickerOpen = false;
  let linkTooltip;
  let activeLink = null;
  let linkTooltipStyle = '';
  let mounted = false;
  let handledRefreshRequest = 0;
  let handledExternalPasteRequest = 0;

  $: fontStack = editorFontStack(font);
  $: displayedLabels = visibleLabelNames(labels);
  $: visibleAvailableLabels = filterVisibleLabels(availableLabels);
  $: desiredPinned = pinned || Boolean(issue?.labels?.some((label) => isPinLabel(label)));
  $: if (mounted && remoteIssue?.number) syncPinLabelToParent();
  $: viewedAttachment = viewerIndex >= 0 ? attachments[viewerIndex] : null;
  $: displayBody = compressAttachmentLinks(body, repo);
  $: previewBody = expandAttachmentLinks(body, repo);
  $: hasAttachmentRefs = parseAttachmentPaths(body).length > 0;
  $: editable = !archived && !readOnly;
  $: canPreview = lockState !== 'locked' && !lockPanelMode;
  $: compactStatus = !editable
    ? $_("m.601dcc1c87")
    : saveFailed
      ? $_("m.0a44446762")
      : '';
  $: showSaveStatus = !editable || saveFailed || saving;
  $: if (remoteIssue?.number && lockState !== 'locked' && reconciledIssueNumber !== remoteIssue.number) {
    reconciledIssueNumber = remoteIssue.number;
    reconcileIssueAttachments(remoteIssue.number);
  }
  $: if (remoteIssue?.number && commentsIssueNumber !== remoteIssue.number) {
    commentsIssueNumber = remoteIssue.number;
    loadIssueComments(remoteIssue.number);
  }
  $: if (labelMutation?.id && labelMutation.id !== appliedLabelMutation) {
    applyLabelMutation(labelMutation);
  }
  $: if (mounted && !paused && refreshRequest > handledRefreshRequest) {
    handleBackgroundRefreshRequest();
  }
  $: if (mounted && !paused && externalPasteRequest?.id > handledExternalPasteRequest) {
    handleExternalPasteRequest();
  }
  $: lockSessionLabel = lockSessionMinutes % 60 === 0
    ? `${lockSessionMinutes / 60}시간`
    : `${lockSessionMinutes}분`;

  $: if (mounted && lockState === 'locked' && lockPin && lockPin !== activeLockPin && !lockPanelBusy) {
    reuseLockPin(lockPin);
  }
  $: if (mounted && lockState === 'unlocked' && !lockPin && activeLockPin && !lockSessionExpiring) {
    expireLockSession();
  }

  onMount(() => {
    const recovered = !editable || ignoreRecoveredDraft ? null : readDraft();
    if (recovered) {
      title = recovered.title;
      body = recovered.body;
      labels = Array.isArray(recovered.labels) ? recovered.labels : labels;
      dirty = true;
      notifyDraftChange();
      scheduleRemoteSave();
    } else if (initialDraft?.body) {
      changed();
    }

    mounted = true;
    if (lockState === 'locked') {
      if (lockPin) reuseLockPin(lockPin);
      else openLockPanel('unlock');
    }
    handleBackgroundRefreshRequest();

    localTimer = setInterval(() => {
      if (dirty) persistLocalDraft();
    }, 1000);
    window.addEventListener('beforeunload', handlePageExit);
    window.addEventListener('pagehide', handlePageExit);
    window.addEventListener('keydown', handleMoreToolbarEscape, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if ((!issue || justCreated) && editable && !paused) {
      tick().then(() => bodyInput?.focus());
    }

  });

  $: if (
    focusRequest > handledFocusRequest
    && !paused
    && lockState !== 'locked'
  ) {
    handledFocusRequest = focusRequest;
    tick().then(() => bodyInput?.focus());
  }

  afterUpdate(() => {
    const becamePaused = paused && !wasPaused;
    wasPaused = paused;
    if (becamePaused && dirty) flushRemoteSave();
  });

  onDestroy(() => {
    destroyed = true;
    if (dirty) persistLocalDraft();
    clearInterval(localTimer);
    clearTimeout(remoteTimer);
    clearTimeout(lockReuseTimer);
    window.removeEventListener('beforeunload', handlePageExit);
    window.removeEventListener('pagehide', handlePageExit);
    window.removeEventListener('keydown', handleMoreToolbarEscape, true);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (dirty) saveRemote(false, true);
    Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url));
    previewUrls = {};
  });

  function draftStore() {
    try {
      return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function readDraft() {
    return draftStore()[repo]?.[draftId] || null;
  }

  function persistLocalDraft() {
    if (!dirty) return;
    if (lockState !== 'plain') {
      removeLocalDraft();
      return;
    }
    const store = draftStore();
    store[repo] ||= {};
    store[repo][draftId] = { title, body, labels, savedAt: Date.now() };
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(store));
  }

  function removeLocalDraft() {
    const store = draftStore();
    if (!store[repo]) return;
    delete store[repo][draftId];
    if (!Object.keys(store[repo]).length) delete store[repo];
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(store));
  }

  function flushRemoteSave(requestOptions = {}) {
    if (!dirty || archived) return;
    persistLocalDraft();
    if (refreshing) return;
    clearTimeout(remoteTimer);
    if (saving && requestOptions.keepalive) {
      saveKeepaliveSnapshot(requestOptions);
      return;
    }
    saveRemote(false, true, requestOptions);
  }

  function saveFocusedChangesNow(target) {
    const commentElement = target?.closest?.('.note-comment-body');
    if (commentElement) {
      const comment = comments.find((item) => `comment-body-${item.id}` === commentElement.id);
      if (comment) saveComment(comment, true);
      return;
    }

    if (target === bodyInput || target?.closest?.('.inline-title')) {
      clearTimeout(remoteTimer);
      saveRemote(true, true);
    }
  }

  function saveKeepaliveSnapshot(requestOptions) {
    // 이미 진행 중인 저장의 최신 본문을 직접 PATCH하면, 닫힘 상태를 확인하는
    // 일반 저장 경로를 우회하게 된다. 현재 저장이 끝난 뒤 같은 경로로 한 번 더
    // 저장하도록 큐에 넣어, 닫힌 이슈를 실수로 수정하지 않게 한다.
    saveRemote(true, true, requestOptions);
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') flushRemoteSave();
  }

  function handlePageExit() {
    flushRemoteSave({ keepalive: true });
  }

  function changed() {
    if (!editable || lockState === 'locked') return;
    if (titleMode === 'first-line') title = automaticTitle(body);
    dirty = true;
    saveFailed = false;
    revision += 1;
    error = '';
    notifyDraftChange();
    scheduleRemoteSave();
  }

  function notifyDraftChange() {
    onDraftChange(draftPayload());
  }

  function draftPayload() {
    const resolvedTitle = lockState === 'locked'
      ? title.trim()
      : titleMode === 'first-line' ? automaticTitle(body) : title.trim();
    return {
      title: lockState === 'plain'
        ? resolvedTitle || $_("m.2b7b05c002")
        : addLockToTitle(resolvedTitle || $_("m.2b7b05c002")),
      body: lockState === 'plain' ? body : encryptedBody,
      labels: labels.map((name) => ({ name })),
      updated_at: new Date().toISOString()
    };
  }

  function scheduleRemoteSave(delay = autoSaveSeconds * 1000) {
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(() => saveRemote(), delay);
  }

  function currentNote() {
    const trimmedBody = body.trim();
    const resolvedTitle = lockState === 'locked'
      ? title.trim()
      : titleMode === 'first-line'
      ? automaticTitle(trimmedBody) || (attachments.length ? $_("m.c33437b1cb") : '')
      : title.trim();
    return {
      title: resolvedTitle,
      body: trimmedBody,
      labels
    };
  }

  function noteSignature(note) {
    return JSON.stringify({
      title: note.title,
      body: note.body,
      labels: note.labels
    });
  }

  function notePayloadFromIssue(remote) {
    return {
      title: remote?.title || '',
      body: remote?.body || '',
      labels: (remote?.labels || []).map((label) => label.name)
    };
  }

  function withRevivedAttachmentLinks(bodyText) {
    if (!orphanedAttachments.length) return bodyText;
    const links = orphanedAttachments.map((attachment) => composeAttachmentLink(repo, attachment));
    orphanedAttachments = [];
    return `${links.join('\n')}\n\n${bodyText}`;
  }

  async function noteForRemote(note) {
    if (lockState === 'plain') return { ...note, body: withRevivedAttachmentLinks(note.body) };
    if (lockState === 'locked') {
      return { ...note, title: addLockToTitle(note.title), body: encryptedBody };
    }
    if (!activeLockPin) throw new Error('잠금 세션이 만료되었습니다.');
    const remoteBody = withRevivedAttachmentLinks(note.body);
    encryptedBody = await encryptLockedBody(remoteBody, activeLockPin, issue?.number || remoteIssue?.number);
    return { ...note, title: addLockToTitle(note.title), body: encryptedBody };
  }

  function openLockPanel(mode) {
    lockPanelMode = mode;
    lockPanelPin = '';
    lockPanelError = '';
    tick().then(() => document.querySelector(`#note-lock-pin-${editorId}`)?.focus());
  }

  function focusBodyFromOuterGutter(node) {
    const handlePointerDown = (event) => {
      if (event.target !== node || !editable || lockState === 'locked') return;
      event.preventDefault();
      bodyInput?.focus();
    };
    node.addEventListener('pointerdown', handlePointerDown);
    return { destroy: () => node.removeEventListener('pointerdown', handlePointerDown) };
  }

  function closeLockPanel() {
    if (lockPanelBusy || lockState === 'locked') return;
    lockPanelMode = '';
    lockPanelPin = '';
    lockPanelError = '';
  }

  function handleLockPinInput(event) {
    const digits = event.currentTarget.value.replace(/[^0-9]/g, '').slice(0, 6);
    event.currentTarget.value = digits;
    lockPanelPin = digits;
    lockPanelError = '';
    if (digits.length === 6 && lockPanelMode !== 'lock' && !lockPanelBusy) void submitLockPanel();
  }

  async function submitLockPanel() {
    if (lockPanelBusy) return;
    const pin = normalizeLockPin(lockPanelPin);
    if (!pin) {
      lockPanelError = '6자리 숫자를 입력해 주세요.';
      return;
    }
    lockPanelBusy = true;
    lockPanelError = '';
    try {
      if (lockPanelMode === 'lock') {
        await lockNote(pin);
      } else {
        await revealLockedNote(pin);
      }
    } catch (reason) {
      lockPanelError = reason?.message || '잠금을 처리하지 못했습니다.';
      lockPanelPin = '';
      tick().then(() => document.querySelector(`#note-lock-pin-${editorId}`)?.focus());
    } finally {
      lockPanelBusy = false;
    }
  }

  async function requestLock() {
    const sessionPin = normalizeLockPin(lockPin);
    if (!sessionPin) {
      openLockPanel('lock');
      return;
    }
    lockPanelBusy = true;
    lockPanelError = '';
    try {
      await lockNote(sessionPin);
    } catch (reason) {
      lockPanelMode = 'lock';
      lockPanelError = reason?.message || '잠금을 처리하지 못했습니다.';
    } finally {
      lockPanelBusy = false;
    }
  }

  async function lockNote(pin) {
    // 새 노트는 이슈 번호가 아직 발급 중일 수 있는데, 그 번호가 암호화 컨텍스트라 먼저 기다린다.
    const target = issue || await resolveRemoteIssue();
    activeLockPin = pin;
    onSetLockSession(pin);
    encryptedBody = await encryptLockedBody(body, pin, target?.number);
    lockState = 'unlocked';
    lockPanelMode = '';
    removeLocalDraft();
    changed();
    clearTimeout(remoteTimer);
    await saveRemote(true);
  }

  async function revealLockedNote(pin, automatic = false) {
    if (!encryptedBody || lockState !== 'locked') return;
    lockPanelBusy = true;
    try {
      const contextIssueNumber = issue?.number || remoteIssue?.number;
      body = await decryptLockedBody(encryptedBody, pin, contextIssueNumber);
      activeLockPin = pin;
      lockState = 'unlocked';
      lockPanelMode = '';
      lockPanelPin = '';
      lockPanelError = '';
      onSetLockSession(pin);
      lastRemoteSignature = noteSignature(currentNote());
      comments = await decryptCommentBodies(comments, pin, contextIssueNumber);
    } catch (reason) {
      if (!automatic) throw reason;
      activeLockPin = '';
      lockPanelMode = 'unlock';
      lockPanelError = reason?.message || '6자리 숫자가 맞지 않습니다.';
    } finally {
      lockPanelBusy = false;
    }
  }

  function reuseLockPin(pin) {
    if (lockState !== 'locked' || lockPanelBusy) return;
    clearTimeout(lockReuseTimer);
    lockPanelMode = 'reuse';
    lockPanelError = '';
    lockPanelBusy = true;
    lockReuseTimer = setTimeout(async () => {
      try {
        await revealLockedNote(pin, true);
      } finally {
        lockPanelBusy = false;
      }
    }, 1000);
  }

  async function expireLockSession() {
    lockSessionExpiring = true;
    try {
      if (dirty && activeLockPin) {
        clearTimeout(remoteTimer);
        await saveRemote(true, true);
      }
    } finally {
      activeLockPin = '';
      body = encryptedBody;
      lockState = 'locked';
      lockPanelMode = 'unlock';
      lockPanelPin = '';
      lockPanelError = '잠금 시간이 만료되었습니다. 6자리 숫자를 다시 입력해 주세요.';
      lockSessionExpiring = false;
    }
  }

  async function removeLock() {
    if (lockState !== 'unlocked') {
      openLockPanel('unlock');
      return;
    }
    lockState = 'plain';
    encryptedBody = '';
    activeLockPin = '';
    changed();
    clearTimeout(remoteTimer);
    await saveRemote(true);
  }

  async function resolveRemoteIssue() {
    if (remoteIssue?.number) return remoteIssue;
    if (!allocationPromise) return null;
    const allocated = await allocationPromise;
    if (allocated?.number) remoteIssue = allocated;
    return remoteIssue;
  }

  async function applyRemoteIssue(refreshed) {
    remoteIssue = refreshed;
    const refreshedLocked = isLockedTitle(refreshed.title);
    title = removeLockFromTitle(refreshed.title || '');
    encryptedBody = refreshedLocked ? refreshed.body || '' : '';
    body = refreshed.body || '';
    lockState = refreshedLocked ? 'locked' : 'plain';
    activeLockPin = '';
    labels = (refreshed.labels || []).map((label) => label.name);
    if (refreshedLocked && lockPin) await revealLockedNote(lockPin, true);
    dirty = false;
    revision += 1;
    lastRemoteSignature = noteSignature(currentNote());
    removeLocalDraft();
    reconciledIssueNumber = null;
  }

  async function discardLocalChanges(refreshed) {
    clearTimeout(remoteTimer);
    forceSaveQueued = false;
    forceSaveAllowPaused = false;
    await applyRemoteIssue(refreshed);
    saveFailed = false;
    error = '';
    onRefreshed(refreshed);
  }

  async function prepareExistingIssueSave(targetIssue) {
    if (!targetIssue?.number) return { targetIssue, reopen: false };

    const latestIssue = await getIssue(token, repo, targetIssue.number);
    if (destroyed) return { cancelled: true };
    if (!latestIssue) return { targetIssue, reopen: false };

    remoteIssue = latestIssue;
    if (latestIssue.state !== 'closed') {
      return { targetIssue: latestIssue, reopen: false, previousIssue: latestIssue };
    }

    const shouldReopen = confirm($_('dynamic.closedIssueSaveConfirm', {
      values: { title: latestIssue.title || targetIssue.title || title }
    }));
    if (!shouldReopen) {
      await discardLocalChanges(latestIssue);
      return { cancelled: true };
    }
    return { targetIssue: latestIssue, reopen: true, previousIssue: latestIssue };
  }

  async function resolveLateClosedSave(saved, previousIssue, remoteNote, requestOptions) {
    if (saved?.state !== 'closed') return { saved, cancelled: false };

    const shouldReopen = confirm($_('dynamic.closedIssueSaveConfirm', {
      values: { title: saved.title || previousIssue?.title || title }
    }));
    if (shouldReopen) {
      const reopened = await updateIssue(token, repo, saved.number, {
        ...remoteNote,
        state: 'open'
      }, requestOptions);
      return { saved: reopened, cancelled: false };
    }

    // 드물게 GET과 PATCH 사이에 다른 디바이스가 닫을 수 있다. 이미 본문이
    // 반영된 응답이라면 직전에 읽은 원격 내용을 다시 써서 '아니오'를 실제
    // 폐기로 만든다. 응답 본문이 달라졌다면 다른 수정이 섞였을 수 있으므로
    // 무리하게 롤백하지 않고 현재 원격 내용을 그대로 다시 읽는다.
    let discarded = saved;
    if (
      previousIssue
      && noteSignature(notePayloadFromIssue(saved)) === noteSignature(remoteNote)
    ) {
      discarded = await updateIssue(
        token,
        repo,
        saved.number,
        notePayloadFromIssue(previousIssue),
        requestOptions
      );
    }
    await discardLocalChanges({ ...discarded, state: 'closed' });
    return { saved: discarded, cancelled: true };
  }

  async function saveRemote(force = false, allowPaused = false, requestOptions = {}) {
    if (archived) return;
    if (saving) {
      const hasNewerContent = noteSignature(currentNote()) !== activeSavingSignature;
      if (force && hasNewerContent) {
        forceSaveQueued = true;
        forceSaveAllowPaused = forceSaveAllowPaused || allowPaused;
      }
      return;
    }
    if (!force && !dirty) return;
    if (paused && !allowPaused) {
      if (!force) scheduleRemoteSave();
      return;
    }
    persistLocalDraft();
    const note = currentNote();
    if (!note.title) {
      return;
    }
    const signature = noteSignature(note);
    if (!force && signature === lastRemoteSignature) {
      dirty = false;
      removeLocalDraft();
      return;
    }

    const savingRevision = revision;
    activeSavingSignature = signature;
    saving = true;
    saveFailed = false;
    error = '';

    try {
      let targetIssue = issue || await resolveRemoteIssue();
      let reopenRequested = false;
      let previousIssue = null;
      if (targetIssue?.number && issue && !destroyed) {
        const prepared = await prepareExistingIssueSave(targetIssue);
        if (prepared.cancelled) return;
        targetIssue = prepared.targetIssue;
        reopenRequested = prepared.reopen;
        previousIssue = prepared.previousIssue;
      }
      if (destroyed && issue) return;

      const knownNames = new Set(visibleAvailableLabels.map((label) => label.name.toLocaleLowerCase()));
      const missingNames = labels.filter((name) => !isPinLabel(name) && !knownNames.has(name.toLocaleLowerCase()));
      const createdLabels = await Promise.all(
        missingNames.map((name) => createLabel(token, repo, name, requestOptions))
      );
      if (createdLabels.length) {
        availableLabels = [...availableLabels, ...createdLabels];
        onLabelsAvailable(createdLabels);
      }
      if (destroyed && issue) return;

      const remoteNote = await noteForRemote(note);
      let saved = targetIssue
        ? await updateIssue(
          token,
          repo,
          targetIssue.number,
          reopenRequested ? { ...remoteNote, state: 'open' } : remoteNote,
          requestOptions
        )
        : await createIssue(token, repo, remoteNote, requestOptions);

      if (targetIssue && !reopenRequested) {
        const lateResolution = await resolveLateClosedSave(
          saved,
          previousIssue,
          remoteNote,
          requestOptions
        );
        if (lateResolution.cancelled) return;
        saved = lateResolution.saved;
      }

      // 이 시점에 컴포넌트가 이미 파괴됐다면(예: 새 노트가 번호를 받아
      // note.{번호}로 리마운트됨) 요청 자체는 이미 서버에 반영됐으므로 되돌리지
      // 않되, onSaved/onCreated를 또 호출하거나 이 죽은 인스턴스가 스스로
      // 다음 저장을 예약하는 일은 막는다. 그러지 않으면 부모의 noteCreated()가
      // 두 번 실행되거나, 새로 마운트된 인스턴스와 무관하게 낡은 내용이 나중에
      // 덮어쓸 수 있다.
      if (destroyed) return;

      remoteIssue = saved;
      if (lockState !== 'plain') encryptedBody = saved.body || encryptedBody;
      lastRemoteSignature = signature;
      const hasNewerChanges = savingRevision !== revision || noteSignature(currentNote()) !== signature;
      if (issue) onSaved(saved, hasNewerChanges ? draftPayload() : null);
      if (!hasNewerChanges) {
        dirty = false;
        removeLocalDraft();
      } else {
        scheduleRemoteSave();
      }
      saveFailed = false;

      if (!issue && !hasNewerChanges) onCreated(saved);
    } catch (reason) {
      saveFailed = true;
      error = reason?.status === 401
        ? $_("m.faea518485")
        : reason?.status === 403
          ? $_("m.fde564557e")
          : reason?.message || $_("m.3a743b0e61");
      if (!destroyed) scheduleRemoteSave(15000);
    } finally {
      saving = false;
      activeSavingSignature = '';
      if (forceSaveQueued && !destroyed) {
        const queuedAllowPaused = forceSaveAllowPaused;
        forceSaveQueued = false;
        forceSaveAllowPaused = false;
        clearTimeout(remoteTimer);
        saveRemote(true, queuedAllowPaused);
      }
    }
  }

  function handleBackgroundRefreshRequest() {
    if (refreshRequest <= handledRefreshRequest) return;
    handledRefreshRequest = refreshRequest;
    if (!dirty && !saving) refreshIssue(true);
    else onRefreshStateChange(false);
  }

  function handleExternalPasteRequest() {
    const request = externalPasteRequest;
    if (!request?.id || request.id <= handledExternalPasteRequest) return;
    handledExternalPasteRequest = request.id;
    onExternalPasteHandled(request.id);
    uploadFiles(request.files);
  }

  async function refreshIssue(background = false) {
    const targetIssue = issue || remoteIssue;
    if (!targetIssue?.number || saving || refreshing || backgroundRefreshing) {
      if (background) onRefreshStateChange(false);
      return;
    }
    if (background && dirty) {
      onRefreshStateChange(false);
      return;
    }
    if (!background && dirty && !confirm($_("m.37533033a1"))) {
      return;
    }

    const hadDirtyChanges = dirty;
    const startingRevision = revision;
    const startingSignature = noteSignature(currentNote());
    if (background) {
      backgroundRefreshing = true;
      onRefreshStateChange(true);
    }
    else {
      refreshing = true;
      error = '';
      clearTimeout(remoteTimer);
    }
    try {
      const refreshed = await getIssue(token, repo, targetIssue.number);
      if (destroyed) return;
      if (
        background
        && (dirty || revision !== startingRevision || noteSignature(currentNote()) !== startingSignature)
      ) return;
      const refreshedSignature = noteSignature({
        title: refreshed.title || '',
        body: refreshed.body || '',
        labels: (refreshed.labels || []).map((label) => label.name)
      });
      const currentRemoteSignature = remoteIssue ? noteSignature({
        title: remoteIssue.title || '',
        body: remoteIssue.body || '',
        labels: (remoteIssue.labels || []).map((label) => label.name)
      }) : '';
      if (background && refreshedSignature === currentRemoteSignature) {
        remoteIssue = refreshed;
        lastRemoteSignature = refreshedSignature;
        return;
      }
      await applyRemoteIssue(refreshed);
      onRefreshed(refreshed);
    } catch (reason) {
      if (background) return;
      error = reason?.message || $_("m.a129ed8520");
      if (hadDirtyChanges) scheduleRemoteSave();
    } finally {
      if (background) {
        backgroundRefreshing = false;
        onRefreshStateChange(false);
      }
      else refreshing = false;
    }
  }

  async function uploadFiles(fileList) {
    if (!editable) return;
    if (uploadBatchActive) {
      error = $_("m.12c0dff05d");
      return;
    }
    uploadBatchActive = true;
    const insertionPoint = bodyInput ? bodyInput.selectionStart : null;
    const requestedFiles = Array.from(fileList || []);
    const remainingSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const files = requestedFiles.slice(0, remainingSlots);
    const limitReached = requestedFiles.length > remainingSlots;
    if (!files.length) {
      if (limitReached) error = $_('dynamic.attachmentLimit', { values: { count: MAX_ATTACHMENTS } });
      if (fileInput) fileInput.value = '';
      uploadBatchActive = false;
      return;
    }
    const targetIssue = await resolveRemoteIssue();
    if (!targetIssue?.number) {
      error = $_("m.510647ea33");
      uploadBatchActive = false;
      return;
    }
    const uploadedAttachments = [];
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        error = $_('dynamic.fileTooLarge', { values: { name: file.name } });
        continue;
      }

      uploading += 1;
      error = '';
      try {
        const attachment = await uploadAttachment(token, repo, targetIssue.number, file);
        uploadedAttachments.push(attachment);
        if (!destroyed) {
          replaceAttachments([...attachments, attachment]);
          retainPreviewUrl(attachment.path, URL.createObjectURL(file));
        }
      } catch (reason) {
        error = reason?.status === 403
          ? $_("m.8c4abbd3b6")
          : reason?.message || $_("m.d5ca50a853");
      } finally {
        uploading -= 1;
      }
    }
    if (uploadedAttachments.length) {
      const links = uploadedAttachments.map((attachment) => composeAttachmentLink(repo, attachment));
      body = insertAttachmentLinks(body, links, insertionPoint);
      changed();
      clearTimeout(remoteTimer);
      await saveRemote(true);
    }
    reconciledIssueNumber = null;
    if (limitReached && !error) {
      error = $_('dynamic.attachmentLimitAdded', { values: { count: MAX_ATTACHMENTS } });
    }
    if (fileInput) fileInput.value = '';
    uploadBatchActive = false;
  }

  function handlePaste(event) {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    uploadFiles(files);
  }

  function hasDraggedFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes('Files');
  }

  function handleDragEnter(event) {
    if (!editable || !hasDraggedFiles(event)) return;
    event.preventDefault();
    draggingFiles = true;
  }

  function handleDragOver(event) {
    if (!editable || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    draggingFiles = true;
  }

  function handleDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    draggingFiles = false;
  }

  function handleDrop(event) {
    if (!editable || !hasDraggedFiles(event)) return;
    event.preventDefault();
    draggingFiles = false;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) uploadFiles(files);
  }

  function handleBodyInput(event) {
    body = expandAttachmentLinks(displayBody, repo);
    changed();
    updateLinkTooltip(event);
  }

  function updateLinkTooltip(event) {
    const textarea = event?.currentTarget || bodyInput;
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) {
      hideLinkTooltip();
      return;
    }
    const nextLink = linkAtCursor(textarea.value, textarea.selectionStart);
    if (!nextLink) {
      hideLinkTooltip();
      return;
    }
    activeLink = nextLink;
    positionLinkTooltip(textarea);
  }

  function positionLinkTooltip(textarea) {
    requestAnimationFrame(() => {
      if (!activeLink || !textarea?.isConnected) return;
      const style = getComputedStyle(textarea);
      const bounds = textarea.getBoundingClientRect();
      const mirror = document.createElement('div');
      const marker = document.createElement('span');
      Object.assign(mirror.style, {
        position: 'fixed',
        visibility: 'hidden',
        pointerEvents: 'none',
        overflow: 'hidden',
        boxSizing: style.boxSizing,
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        padding: style.padding,
        border: style.border,
        font: style.font,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word'
      });
      mirror.textContent = textarea.value.slice(0, textarea.selectionStart);
      marker.textContent = '\u200b';
      mirror.append(marker);
      document.body.append(mirror);
      mirror.scrollTop = textarea.scrollTop;
      mirror.scrollLeft = textarea.scrollLeft;
      const markerBounds = marker.getBoundingClientRect();
      const tooltipWidth = Math.min(420, Math.max(220, window.innerWidth - 16));
      const left = Math.min(
        window.innerWidth - tooltipWidth - 8,
        Math.max(8, markerBounds.left)
      );
      let top = markerBounds.top - 40;
      if (top < 8) top = markerBounds.bottom + 8;
      linkTooltipStyle = `left:${left}px;top:${top}px;max-width:${tooltipWidth}px`;
      mirror.remove();
    });
  }

  function hideLinkTooltip() {
    activeLink = null;
    linkTooltipStyle = '';
  }

  function handleBodyBlur(event) {
    if (event.relatedTarget !== linkTooltip) hideLinkTooltip();
    flushRemoteSave();
  }

  function keepLinkTooltipOpen(event) {
    // A mouse click normally blurs the textarea before the anchor receives its
    // click. That unmounts this cursor tooltip and loses the navigation.
    event.preventDefault();
  }

  function isImage(attachment) {
    return attachment?.type?.startsWith('image/')
      || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(attachment?.name || '');
  }

  function isCurrentAttachment(path) {
    return !destroyed && attachments.some((attachment) => attachment.path === path);
  }

  function retainPreviewUrl(path, url) {
    const existingUrl = previewUrls[path];
    if (existingUrl) {
      URL.revokeObjectURL(url);
      return existingUrl;
    }
    if (!isCurrentAttachment(path)) {
      URL.revokeObjectURL(url);
      return '';
    }
    previewUrls = { ...previewUrls, [path]: url };
    return url;
  }

  function replaceAttachments(nextAttachments) {
    attachments = nextAttachments;
    const currentPaths = new Set(nextAttachments.map((attachment) => attachment.path));
    const nextPreviewUrls = {};
    let removedPreview = false;

    for (const [path, url] of Object.entries(previewUrls)) {
      if (currentPaths.has(path)) nextPreviewUrls[path] = url;
      else {
        URL.revokeObjectURL(url);
        removedPreview = true;
      }
    }

    if (removedPreview) previewUrls = nextPreviewUrls;
  }

  async function loadPreview(attachment) {
    if (!attachment || previewUrls[attachment.path]) return previewUrls[attachment.path];
    try {
      const blob = await downloadAttachment(token, repo, attachment);
      if (!isCurrentAttachment(attachment.path)) return '';
      return retainPreviewUrl(attachment.path, URL.createObjectURL(blob));
    } catch (reason) {
      error = reason?.message || $_("m.4a71ec7a03");
      return '';
    }
  }

  async function removeAttachment(attachment) {
    if (!editable || deletingPath) return;
    if (!confirm($_('dynamic.deleteAttachmentConfirm', { values: { name: attachment.name } }))) return;
    deletingPath = attachment.path;
    error = '';
    let fileDeleted = false;
    try {
      try {
        await deleteAttachment(token, repo, attachment);
      } catch (reason) {
        if (reason?.status !== 404) throw reason;
      }
      fileDeleted = true;
      orphanedAttachments = orphanedAttachments.filter((item) => item.path !== attachment.path);
      const link = composeAttachmentLink(repo, attachment);
      if (body.includes(link)) {
        body = removeAttachmentLink(body, link);
        changed();
        clearTimeout(remoteTimer);
        await saveRemote(true);
      }
      if (previewUrls[attachment.path]) URL.revokeObjectURL(previewUrls[attachment.path]);
      const nextPreviewUrls = { ...previewUrls };
      delete nextPreviewUrls[attachment.path];
      previewUrls = nextPreviewUrls;
      const removedIndex = attachments.findIndex((item) => item.path === attachment.path);
      replaceAttachments(attachments.filter((item) => item.path !== attachment.path));
      if (viewerIndex === removedIndex) closeViewer();
      else if (viewerIndex > removedIndex) viewerIndex -= 1;
    } catch (reason) {
      error = reason?.message || $_("m.f8a2b33cc2");
    } finally {
      deletingPath = '';
      if (fileDeleted) reconciledIssueNumber = null;
    }
  }

  function inferredAttachmentName(file) {
    return file.name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/i, '');
  }

  function inferredAttachmentType(name) {
    const extension = name.split('.').pop()?.toLocaleLowerCase();
    return {
      avif: 'image/avif', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg',
      png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp'
    }[extension] || 'application/octet-stream';
  }

  async function reconcileIssueAttachments(issueNumber) {
    attachmentsLoading = true;
    try {
      const files = await listIssueAttachmentFiles(token, repo, issueNumber);
      if (destroyed || remoteIssue?.number !== issueNumber) return;
      if (uploading || deletingPath) {
        reconciledIssueNumber = null;
        return;
      }
      const filesByPath = new Map(files.map((file) => [file.path, file]));
      const connectedPaths = new Set();
      const linkedAttachments = [];

      for (const path of parseAttachmentPaths(body)) {
        const file = filesByPath.get(path);
        if (!file || connectedPaths.has(path)) continue;
        connectedPaths.add(path);
        const name = inferredAttachmentName(file);
        linkedAttachments.push({ ...file, name, type: inferredAttachmentType(name) });
      }

      // 파일은 남아있는데 본문 링크만 사라진 경우 명시적으로 삭제한 게 아니므로 목록에는 계속 남겨두고,
      // 실제 본문 복구는 다음 저장 시점(noteForRemote)에만 반영해 현재 편집 화면은 건드리지 않는다.
      orphanedAttachments = files
        .filter((file) => !connectedPaths.has(file.path))
        .map((file) => {
          const name = inferredAttachmentName(file);
          return { ...file, name, type: inferredAttachmentType(name) };
        });

      if (destroyed || remoteIssue?.number !== issueNumber) return;
      replaceAttachments([...linkedAttachments, ...orphanedAttachments]);
      attachments.filter(isImage).forEach(loadPreview);
    } catch (reason) {
      if (!destroyed) error = reason?.message || $_("m.ab5becbd3a");
    } finally {
      attachmentsLoading = false;
    }
  }

  async function decryptCommentBodies(rawComments, pin, issueNumber) {
    if (!pin) return rawComments;
    return Promise.all(rawComments.map(async (comment) => {
      if (!isLockedPayload(comment.body)) return comment;
      try {
        return { ...comment, body: await decryptLockedBody(comment.body, pin, issueNumber) };
      } catch {
        return comment;
      }
    }));
  }

  async function loadIssueComments(issueNumber) {
    loadingComments = Number(remoteIssue?.comments || 0) > 0;
    try {
      const nextComments = await listIssueComments(token, repo, issueNumber);
      if (destroyed || remoteIssue?.number !== issueNumber) return;
      comments = lockState === 'unlocked'
        ? await decryptCommentBodies(nextComments, activeLockPin, issue?.number || remoteIssue?.number)
        : nextComments;
    } catch (reason) {
      if (!destroyed) error = reason?.message || $_("m.ab5becbd3a");
    } finally {
      if (!destroyed && remoteIssue?.number === issueNumber) loadingComments = false;
    }
  }

  function markCommentDirty(comment) {
    commentSaveFailedIds.delete(comment.id);
    commentSaveFailedIds = commentSaveFailedIds;
    dirtyCommentIds.add(comment.id);
    dirtyCommentIds = dirtyCommentIds;
  }

  function discardNewComment(comment) {
    comments = comments.filter((item) => item.id !== comment.id);
    dirtyCommentIds.delete(comment.id);
    commentSaveFailedIds.delete(comment.id);
  }

  async function saveComment(comment, force = false) {
    if (!editable || lockState === 'locked') return;
    if (savingCommentIds.has(comment.id)) return;
    const trimmedBody = comment.body.trim();
    if (comment.isNew && !trimmedBody) {
      discardNewComment(comment);
      return;
    }
    if (!force && !dirtyCommentIds.has(comment.id)) return;
    comment.body = trimmedBody;
    savingCommentIds.add(comment.id);
    savingCommentIds = savingCommentIds;
    let savedSuccessfully = false;
    try {
      const remoteBody = lockState === 'unlocked'
        ? await encryptLockedBody(trimmedBody, activeLockPin, issue?.number || remoteIssue?.number)
        : trimmedBody;
      const saved = comment.isNew
        ? await createIssueComment(token, repo, remoteIssue.number, remoteBody)
        : await updateIssueComment(token, repo, comment.id, remoteBody);
      savedSuccessfully = true;
      const hasNewerChanges = comment.body.trim() !== trimmedBody;
      if (comment.isNew) {
        const index = comments.findIndex((item) => item.id === comment.id);
        if (index >= 0) {
          comments[index] = { ...saved, body: hasNewerChanges ? comment.body : trimmedBody };
          comments = comments;
        }
      } else {
        comment.author = saved.author || comment.author;
        comment.updatedAt = saved.updatedAt;
      }
      if (!hasNewerChanges) dirtyCommentIds.delete(comment.id);
    } catch (reason) {
      commentSaveFailedIds.add(comment.id);
      error = reason?.message || $_("m.ab5becbd3a");
    } finally {
      savingCommentIds.delete(comment.id);
      savingCommentIds = savingCommentIds;
      commentSaveFailedIds = commentSaveFailedIds;
      dirtyCommentIds = dirtyCommentIds;
      if (savedSuccessfully && dirtyCommentIds.has(comment.id) && !destroyed) {
        const latestComment = comments.find((item) => item.id === comment.id);
        if (latestComment) saveComment(latestComment);
      }
    }
  }

  async function addComment() {
    if (!editable || lockState === 'locked' || !remoteIssue?.number) return;
    const now = new Date().toISOString();
    const draft = {
      id: `draft-${crypto.randomUUID()}`,
      body: '',
      author: currentUserLogin,
      avatarUrl: '',
      createdAt: now,
      updatedAt: now,
      isNew: true
    };
    comments = [...comments, draft];
    await tick();
    document.getElementById(`comment-body-${draft.id}`)?.focus();
  }

  async function removeComment(comment) {
    if (!editable || lockState === 'locked') return;
    if (comment.isNew) {
      discardNewComment(comment);
      return;
    }
    if (!confirm($_("m.b88a2bf0d1"))) return;
    deletingCommentIds.add(comment.id);
    deletingCommentIds = deletingCommentIds;
    try {
      await deleteIssueComment(token, repo, comment.id);
      comments = comments.filter((item) => item.id !== comment.id);
    } catch (reason) {
      error = reason?.message || $_("m.ab5becbd3a");
    } finally {
      deletingCommentIds.delete(comment.id);
      deletingCommentIds = deletingCommentIds;
    }
  }

  function autosize(node, value) {
    const resize = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };
    resize();
    return { update: resize };
  }

  function insertAttachmentAtEnd(attachment) {
    if (!editable || !attachment || parseAttachmentPaths(body).includes(attachment.path)) return;
    orphanedAttachments = orphanedAttachments.filter((item) => item.path !== attachment.path);
    body = insertAttachmentLinks(body, [composeAttachmentLink(repo, attachment)]);
    changed();
    clearTimeout(remoteTimer);
    saveRemote(true);
  }

  function openViewer(index) {
    viewerIndex = index;
    loadPreview(attachments[index]);
    requestAnimationFrame(() => viewerElement?.focus());
  }

  function closeViewer() {
    viewerIndex = -1;
  }

  function moveViewer(direction) {
    if (!attachments.length) return;
    viewerIndex = (viewerIndex + direction + attachments.length) % attachments.length;
    loadPreview(attachments[viewerIndex]);
  }

  function handleViewerKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeViewer();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveViewer(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveViewer(1);
    }
  }

  function formatFileSize(value) {
    if (!value) return '';
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))}KB`;
    return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  }

  function hasLabel(name) {
    return labels.some((label) => label.toLocaleLowerCase() === name.toLocaleLowerCase());
  }

  function syncPinLabelToParent() {
    const editorHasPinLabel = labels.some((name) => isPinLabel(name));
    if (desiredPinned === editorHasPinLabel) return;
    labels = desiredPinned
      ? [...labels, PIN_LABEL_NAME]
      : labels.filter((name) => !isPinLabel(name));
  }

  function tagColor(name) {
    return `#${tagColorForName(name)}`;
  }

  function formatTimestamp(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat($locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatDateOnly(value) {
    if (!value) return '';
    const date = new Date(value);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return `${formatDateOnly(value)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function applyLabelMutation(mutation) {
    appliedLabelMutation = mutation.id;
    labels = labels
      .filter((name) => mutation.to || name.toLocaleLowerCase() !== mutation.from.toLocaleLowerCase())
      .map((name) => name.toLocaleLowerCase() === mutation.from.toLocaleLowerCase() ? mutation.to : name);
    if (dirty) persistLocalDraft();
    notifyDraftChange();
  }

  function toggleTag(name) {
    if (!name || !editable) return;
    const normalizedName = name.toLocaleLowerCase();
    if (hasLabel(name)) {
      labels = labels.filter((label) => label.toLocaleLowerCase() !== normalizedName);
    } else {
      labels = [...labels, name];
    }
    changed();
  }

  function capturePreviewScrollPosition() {
    if (!editorScroll) return { ratio: 0 };
    const maxScrollTop = Math.max(0, editorScroll.scrollHeight - editorScroll.clientHeight);
    return {
      ratio: maxScrollTop > 0
        ? Math.min(1, Math.max(0, editorScroll.scrollTop / maxScrollTop))
        : 0
    };
  }

  function restorePreviewScrollPosition(position = pendingPreviewScrollPosition) {
    if (!editorScroll || !position) return;
    const maxScrollTop = Math.max(0, editorScroll.scrollHeight - editorScroll.clientHeight);
    editorScroll.scrollTop = maxScrollTop * position.ratio;
  }

  function focusWithoutScrolling(node) {
    if (!node) return;
    try {
      node.focus({ preventScroll: true });
    } catch {
      node.focus();
    }
  }

  async function setMarkdownPreview(next = !previewMode) {
    if (next === previewMode || (next && !canPreview)) return;

    pendingPreviewScrollPosition = capturePreviewScrollPosition();
    toolbarTagPicker?.close?.();
    mobileTagPicker?.close?.();
    inlineTagPickerOpen = false;
    hideMoreToolbarDropdown();
    previewMode = next;
    await tick();
    restorePreviewScrollPosition();
    if (next) markdownViewer?.focus?.();
    else focusWithoutScrolling(editorScroll);
    requestAnimationFrame(() => {
      restorePreviewScrollPosition();
      if (!pendingPreviewScrollPosition) return;
      // MarkdownViewer keeps this anchor alive until all images have either
      // loaded or failed. This second frame handles the no-image case.
      if (!next) pendingPreviewScrollPosition = null;
    });
  }

  function handlePreviewContentResize(event) {
    if (!pendingPreviewScrollPosition) return;
    restorePreviewScrollPosition();
    if (!event.detail?.pendingImages) {
      requestAnimationFrame(() => {
        restorePreviewScrollPosition();
        pendingPreviewScrollPosition = null;
      });
    }
  }

  function hideMoreToolbarDropdown() {
    const toggleButton = moreToolbarElement?.querySelector('[data-bs-toggle="dropdown"]');
    if (toggleButton) Dropdown.getOrCreateInstance(toggleButton).hide();
  }

  function isShortcutWithoutModifiers(event) {
    return !event.repeat
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && !event.isComposing;
  }

  function shortcutKey(event) {
    if (!isShortcutWithoutModifiers(event)) return '';
    const key = event.key?.toLocaleLowerCase();
    if (key === 't' || event.code === 'KeyT') return 't';
    if (key === 'a' || event.code === 'KeyA') return 'a';
    if (key === 'p' || event.code === 'KeyP') return 'p';
    if (key === 'g' || event.code === 'KeyG') return 'g';
    if (key === 'm' || event.code === 'KeyM') return 'm';
    if (key === 'l' || event.code === 'KeyL') return 'l';
    if (key === 'r' || event.code === 'KeyR') return 'r';
    if (key === 's' || event.code === 'KeyS') return 's';
    if (event.key === 'Delete' || event.code === 'Delete') return 'delete';
    return '';
  }

  function hasNoInteractiveFocus() {
    const activeElement = document.activeElement;
    return !activeElement
      || activeElement === document.body
      || activeElement === document.documentElement
      || activeElement === editorScroll
      || activeElement?.classList?.contains('markdown-preview');
  }

  function hasTextEditingFocus() {
    const activeElement = document.activeElement;
    return activeElement instanceof HTMLInputElement
      || activeElement instanceof HTMLTextAreaElement
      || activeElement instanceof HTMLSelectElement
      || Boolean(activeElement?.isContentEditable);
  }

  function openToolbarTagPicker() {
    const picker = window.matchMedia?.('(max-width: 991.98px)').matches
      ? mobileTagPicker || toolbarTagPicker
      : toolbarTagPicker || mobileTagPicker;
    picker?.openPicker?.();
    return Boolean(picker);
  }

  function canUseNoteShortcut(key) {
    if (key === 'm') return previewMode || canPreview;
    if (key === 'l') return editable;
    if (key === 'r') return Boolean((issue || remoteIssue)?.number);
    if (key === 's') return editable && lockState !== 'locked' && !saving;
    if (key === 't') return editable && lockState !== 'locked';
    if (key === 'a') {
      return editable
        && lockState !== 'locked'
        && Boolean(fileInput)
        && !fileInput.disabled;
    }
    if (key === 'p') return Boolean(remoteIssue?.number) && !readOnly && !pinDisabled;
    if (key === 'g') return Boolean(remoteIssue?.html_url) && Boolean(issueLinkElement);
    if (key === 'delete') return Boolean(remoteIssue?.number) && !readOnly && !archived;
    return false;
  }

  function handleNoteShortcut(key) {
    if (!canUseNoteShortcut(key)) return false;
    if (key === 'm') {
      void setMarkdownPreview(!previewMode);
      return true;
    }
    if (key === 'l') {
      void (lockState === 'plain' ? requestLock() : removeLock());
      return true;
    }
    if (key === 'r') {
      location.reload();
      return true;
    }
    if (key === 's') {
      clearTimeout(remoteTimer);
      void saveRemote(true, true);
      return true;
    }
    if (key === 't') {
      return openToolbarTagPicker();
    }
    if (key === 'a') {
      fileInput.click();
      return true;
    }
    if (key === 'p') {
      requestPinToggle();
      return true;
    }
    if (key === 'g') {
      issueLinkElement.click();
      return true;
    }
    if (key === 'delete') {
      onMove(remoteIssue);
      return true;
    }
    return false;
  }

  function handleMoreToolbarEscape(event) {
    if (paused) return;

    if (viewerIndex < 0 && previewMode && event.key === 'Escape' && !hasTextEditingFocus()) {
      event.preventDefault();
      event.stopPropagation();
      void setMarkdownPreview(false);
      return;
    }

    const key = shortcutKey(event);
    if (viewerIndex < 0 && previewMode && key === 'm' && hasNoInteractiveFocus()) {
      event.preventDefault();
      event.stopPropagation();
      void setMarkdownPreview(false);
      return;
    }

    if (viewerIndex < 0 && key && hasNoInteractiveFocus()) {
      if (handleNoteShortcut(key)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (event.key !== 'Escape') return;
    const activeElement = document.activeElement;
    const toolbar = activeElement?.closest?.('.detail-toolbar-more');
    if (!toolbar || !toolbar.querySelector('.dropdown-menu.show')) return;
    event.preventDefault();
    event.stopPropagation();
    const toggleButton = toolbar.querySelector('[data-bs-toggle="dropdown"]');
    if (toggleButton) Dropdown.getOrCreateInstance(toggleButton).hide();
    activeElement.blur?.();
  }

  function handleEditorKeydown(event) {
    const key = event.key?.toLocaleLowerCase();
    if (
      event.altKey
      || event.shiftKey
      || (!event.ctrlKey && !event.metaKey)
      || (key !== 's' && event.code !== 'KeyS')
    ) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    saveFocusedChangesNow(event.currentTarget);
  }

  function prepareReturnToList() {
    // click보다 앞선 pointerdown에서 포커스를 끊어야, 열린 태그 검색 input이
    // 좁은 화면 전환의 스크롤 위치에 영향을 남기지 않는다.
    document.activeElement?.blur?.();
    mobileTagPicker?.close();
  }

  function requestPinToggle() {
    const targetIssue = remoteIssue || issue;
    if (!targetIssue?.number) return;
    // 새 노트가 정식 이슈로 승격된 직후에는 부모의 목록 스냅샷이 한 틱
    // 늦을 수 있다. 현재 편집기 상태를 함께 넘겨야 고정 직후 제목이
    // 초기값인 "새 노트"로 되돌아가지 않는다.
    onTogglePin({ ...targetIssue, ...draftPayload() });
  }

  async function returnToList() {
    // 라우터의 View Transition 스냅샷보다 앞서 DOM에서도 메뉴를 제거한다.
    prepareReturnToList();
    await tick();
    onBack();
  }

  function removeTag(name) {
    if (!editable) return;
    labels = labels.filter((label) => label !== name);
    changed();
  }

</script>

<div class="inline-editor">
  <div class="detail-toolbar">
    <div class="detail-toolbar-start">
      <button
        class="btn btn-outline-secondary mobile-back"
        on:pointerdown={prepareReturnToList}
        on:click={returnToList}
        aria-label={$_("m.747f5bd6a0")}
      >
        <i class="bi bi-arrow-left" aria-hidden="true"></i><span class="mobile-back-label"> {$_("m.a1fffaaafb")}</span>
      </button>
      <span>{#if lockState === 'locked'}<i class="bi bi-lock-fill toolbar-lock-icon" aria-hidden="true"></i>{:else if lockState === 'unlocked'}<i class="bi bi-unlock-fill toolbar-lock-icon" aria-hidden="true"></i>{/if}{issue ? formatDateOnly(issue.updated_at || issue.created_at) : $_("m.2b7b05c002")}</span>
      <span class="save-status" class:is-visible={showSaveStatus} aria-live="polite">
        <BrailleSpinner active={saving} />
        {#if compactStatus}{compactStatus}{/if}
      </span>
    </div>
    {#if editable}
      <input
        bind:this={fileInput}
        class="visually-hidden"
        type="file"
        id={`inline-attachment-${editorId}`}
        aria-keyshortcuts="A"
        multiple
        disabled={uploadBatchActive || attachments.length >= MAX_ATTACHMENTS}
        on:change={(event) => uploadFiles(event.currentTarget.files)}
      />
    {/if}
    <div class="detail-toolbar-actions detail-toolbar-actions-desktop">
      {#if editable}
        <TagPicker
          bind:this={toolbarTagPicker}
          toolbar
          shortcut="T"
          shortcutEnabled={canUseNoteShortcut('t')}
          availableLabels={visibleAvailableLabels}
          selectedLabels={displayedLabels}
          onSelect={toggleTag}
        />
      {/if}
      {#if editable}
        <label
          class="btn btn-sm btn-outline-secondary detail-toolbar-attachment"
          class:disabled={uploadBatchActive || attachments.length >= MAX_ATTACHMENTS}
          for={`inline-attachment-${editorId}`}
        >
          <i class="bi bi-paperclip" aria-hidden="true"></i>
          {uploading ? $_('dynamic.uploading', { values: { count: uploading } }) : $_("m.1afff0157c")} <span class="shortcut-hint"><span class="shortcut-key" class:is-available={canUseNoteShortcut('a')}>A</span></span>
        </label>
      {/if}
    </div>
    <div class="detail-toolbar-actions detail-toolbar-actions-mobile">
      {#if editable}
        <TagPicker
          bind:this={mobileTagPicker}
          toolbar
          iconOnly
          shortcut="T"
          shortcutEnabled={canUseNoteShortcut('t')}
          availableLabels={visibleAvailableLabels}
          selectedLabels={displayedLabels}
          onSelect={toggleTag}
        />
        <label
          class="btn btn-outline-secondary detail-toolbar-icon-action"
          class:disabled={uploadBatchActive || attachments.length >= MAX_ATTACHMENTS}
          for={`inline-attachment-${editorId}`}
          aria-label={`${uploading ? $_('dynamic.uploading', { values: { count: uploading } }) : $_("m.1afff0157c")} A`}
          title={`${uploading ? $_('dynamic.uploading', { values: { count: uploading } }) : $_("m.1afff0157c")} A`}
        >
          <i class="bi bi-paperclip" aria-hidden="true"></i>
        </label>
      {/if}
    </div>
    <div class="dropdown detail-toolbar-more" bind:this={moreToolbarElement}>
      <button
        class="btn btn-outline-secondary responsive-toolbar-button"
        type="button"
        data-bs-toggle="dropdown"
        aria-expanded="false"
        aria-label={$_("m.a9b795bbb6")}
      ><i class="bi bi-three-dots-vertical" aria-hidden="true"></i></button>
      <div class="dropdown-menu dropdown-menu-dark dropdown-menu-end">
        {#if canPreview || previewMode}
          <button
            type="button"
            class="dropdown-item"
            aria-pressed={previewMode}
            aria-keyshortcuts="M"
            on:click={() => setMarkdownPreview()}
          >
            <i class={`bi ${previewMode ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true"></i>
            {$_("m.1e0f7e5b67")} <span class="shortcut-hint"><span class="shortcut-key" class:is-available={canUseNoteShortcut('m')}>M</span></span>
          </button>
        {/if}
        <div class="detail-toolbar-mobile-actions">
          {#if remoteIssue && !readOnly}
            <button
              type="button"
              class="dropdown-item"
              aria-keyshortcuts="Delete"
              on:click={() => onMove(remoteIssue)}
            >
              <i class={`bi ${archived ? 'bi-arrow-counterclockwise' : 'bi-trash3'}`} aria-hidden="true"></i>
              {archived ? $_("m.3cbe6d6b9a") : $_("m.f6fdbe48dc")} <span class="shortcut-hint"><span class="shortcut-key" class:is-available={canUseNoteShortcut('delete')}>Delete</span></span>
            </button>
          {/if}
        </div>
        {#if remoteIssue}
          <div class="dropdown-divider detail-toolbar-mobile-divider"></div>
        {/if}
        {#if editable}
          <button
            type="button"
            class="dropdown-item"
            aria-keyshortcuts="L"
            on:click={() => lockState === 'plain' ? requestLock() : removeLock()}
          >
            <i class={`bi ${lockState === 'plain' ? 'bi-lock' : 'bi-unlock'}`} aria-hidden="true"></i>
            {lockState === 'plain' ? '잠금' : lockState === 'locked' ? '잠금 열기' : '잠금 풀기'} <span class="shortcut-hint"><span class="shortcut-key" class:is-available={canUseNoteShortcut('l')}>L</span></span>
          </button>
        {/if}
        {#if remoteIssue}
          <button
            type="button"
            class="dropdown-item"
            aria-keyshortcuts="P"
            disabled={pinDisabled}
            on:click={requestPinToggle}
          >
            <i class={`bi ${pinned ? 'bi-pin-angle-fill' : 'bi-pin-angle'}`} aria-hidden="true"></i>
            {pinned ? '고정 해제' : '상단고정'} <span class="shortcut-hint"><span class="shortcut-key" class:is-available={canUseNoteShortcut('p')}>P</span></span>
          </button>
        {/if}
        {#if remoteIssue}
          {#if !readOnly}
            <button
              type="button"
              class="dropdown-item detail-toolbar-desktop-delete"
              aria-keyshortcuts="Delete"
              on:click={() => onMove(remoteIssue)}
            >
              <i class={`bi ${archived ? 'bi-arrow-counterclockwise' : 'bi-trash3'}`} aria-hidden="true"></i>
              {archived ? $_("m.3cbe6d6b9a") : $_("m.f6fdbe48dc")} <span class="shortcut-hint"><span class="shortcut-key" class:is-available={canUseNoteShortcut('delete')}>Delete</span></span>
            </button>
          {/if}
          <a
            bind:this={issueLinkElement}
            class="dropdown-item"
            aria-keyshortcuts="G"
            href={remoteIssue.html_url}
            target={newContextTarget}
            rel="noreferrer"
          >
            <i class="bi bi-github" aria-hidden="true"></i> {$_('dynamic.viewOnGitHub')} <span class="shortcut-hint"><span class="shortcut-key" class:is-available={canUseNoteShortcut('g')}>G</span></span>
          </a>
          <div class="dropdown-divider"></div>
          <div class="dropdown-header detail-toolbar-timestamps">
            <span>{$_('dynamic.createdAt', { values: { date: formatTimestamp(remoteIssue.created_at) } })}</span>
            <span>{$_('dynamic.updatedAt', { values: { date: formatTimestamp(remoteIssue.updated_at) } })}</span>
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if error}<div class="editor-notice text-danger">{error}</div>{/if}

  <div class="inline-editor-scroll" bind:this={editorScroll} tabindex="-1" use:focusBodyFromOuterGutter>
  <div
    class="inline-editor-fields"
    class:is-lock-protected={lockState !== 'plain'}
    class:is-dragging-files={draggingFiles}
    role="presentation"
    style={`--note-font:${fontStack};--note-font-size:${fontSize}px;--note-line-height:${lineHeight};--editor-max-width:${maxWidth}px`}
    on:dragenter={handleDragEnter}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
  >
    {#if attachments.length || uploading || deletingPath || (attachmentsLoading && hasAttachmentRefs)}
      <section
        class="attachment-section"
        class:is-loading={Boolean(uploading || deletingPath)}
      >
        {#if !attachments.length && attachmentsLoading}
          <div class="attachment-list-loading">
            <BrailleSpinner active />
          </div>
        {:else}
        <div class="attachment-list">
          {#each attachments as attachment, index (attachment.path)}
            <div class="attachment-item">
              <button type="button" class="attachment-open" on:click={() => openViewer(index)}>
                {#if isImage(attachment)}
                  {#if previewUrls[attachment.path]}
                    <img src={previewUrls[attachment.path]} alt="" />
                  {:else}
                    <span class="attachment-loading">…</span>
                  {/if}
                {:else}
                  <span class="attachment-file-icon">FILE</span>
                {/if}
                <span class="attachment-name" title={attachment.name}>{attachment.name}</span>
              </button>
              {#if editable && !previewMode}
                <button
                  type="button"
                  class="attachment-delete"
                  disabled={Boolean(deletingPath)}
                  on:click={() => removeAttachment(attachment)}
                  aria-label={$_('dynamic.deleteAttachment', { values: { name: attachment.name } })}
                >
                  <i
                    class={`bi ${deletingPath === attachment.path ? 'bi-hourglass-split' : 'bi-x-lg'}`}
                    aria-hidden="true"
                  ></i>
                </button>
              {/if}
            </div>
          {/each}
          {#if editable && !previewMode && attachments.length < MAX_ATTACHMENTS}
            <label
              class="attachment-add-tile"
              class:disabled={uploadBatchActive}
              for={`inline-attachment-${editorId}`}
            >
              <strong><i class="bi bi-plus-lg" aria-hidden="true"></i></strong>
              <span>{uploading ? $_('dynamic.uploading', { values: { count: uploading } }) : $_("m.61cc55aa04")}</span>
            </label>
          {/if}
        </div>
        {/if}
        {#if uploading || deletingPath}
          <div class="attachment-api-overlay" aria-label={$_("m.f4ea49bc96")}>
            <span class="spinner-border spinner-border-sm region-spinner" aria-hidden="true"></span>
          </div>
        {/if}
      </section>
    {/if}
    {#if displayedLabels.length || inlineTagPickerOpen}
      <div class="editor-tags">
        {#each displayedLabels as label (label)}
          <span class="editor-tag" style={`--tag-color:${tagColor(label)}`}>
            #{label}
            {#if editable && !previewMode}
              <button type="button" on:click={() => removeTag(label)} aria-label={$_('dynamic.removeTag', { values: { name: label } })}>
                <i class="bi bi-x" aria-hidden="true"></i>
              </button>
            {/if}
          </span>
        {/each}
        {#if editable && !previewMode}
          <TagPicker
            bind:open={inlineTagPickerOpen}
            availableLabels={visibleAvailableLabels}
            selectedLabels={displayedLabels}
            onSelect={toggleTag}
          />
        {/if}
      </div>
    {/if}
    {#if titleMode === 'separate'}
      {#if previewMode}
        {#if title.trim()}<h1 class="markdown-preview-title">{title}</h1>{/if}
      {:else}
        <input
          class="inline-title"
          bind:value={title}
          on:input={changed}
          placeholder={$_("m.768e0c1c69")}
          maxlength="256"
          aria-label={$_("m.45e6c4d69d")}
          readonly={!editable || lockState === 'locked'}
          on:keydown={handleEditorKeydown}
          on:blur={() => flushRemoteSave()}
        />
      {/if}
    {/if}
    {#if previewMode}
      <MarkdownViewer
        bind:this={markdownViewer}
        source={previewBody}
        emptyLabel={$_("m.0c3fd88e60")}
        on:contentresize={handlePreviewContentResize}
      />
    {:else}
      <textarea
        bind:this={bodyInput}
        class="inline-body"
        bind:value={displayBody}
        on:input={handleBodyInput}
        on:keyup={updateLinkTooltip}
        on:click={updateLinkTooltip}
        on:select={updateLinkTooltip}
        on:scroll={hideLinkTooltip}
        on:keydown={handleEditorKeydown}
        on:blur={handleBodyBlur}
        on:paste={handlePaste}
        placeholder={titleMode === 'first-line' ? $_("m.fd0b5408d9") : $_("m.5f35b29acf")}
        maxlength={MAX_ISSUE_BODY_LENGTH}
        aria-label={$_("m.6aa90334da")}
        autocomplete="off"
        autocorrect="off"
        autocapitalize="none"
        spellcheck="false"
        readonly={!editable || lockState === 'locked'}
        use:autosize={displayBody}
      ></textarea>
    {/if}
    {#if loadingComments || comments.length || (editable && lockState !== 'locked' && remoteIssue?.number)}
      <section class="note-comments-section">
        {#if loadingComments && !comments.length}
          <div class="note-comments-loading">
            <BrailleSpinner active />
          </div>
        {:else}
          {#each comments as comment (comment.id)}
            <div class="note-comment-item">
              <div class="note-comment-meta">
                <span class="note-comment-author">{comment.author}</span>
                <span class="note-comment-date">{formatDateTime(comment.updatedAt || comment.createdAt)}</span>
                <div class="note-comment-side">
                  {#if savingCommentIds.has(comment.id)}
                    <BrailleSpinner active />
                  {:else if commentSaveFailedIds.has(comment.id)}
                    <span class="note-comment-status note-comment-status-failed">{$_("m.0a44446762")}</span>
                  {/if}
                  {#if editable && lockState !== 'locked' && !previewMode}
                    <div class="dropdown">
                      <button
                        type="button"
                        class="note-comment-more"
                        data-bs-toggle="dropdown"
                        aria-expanded="false"
                        aria-label={$_("m.02f145f769")}
                        tabindex="-1"
                      ><i class="bi bi-three-dots" aria-hidden="true"></i></button>
                      <ul class="dropdown-menu dropdown-menu-dark dropdown-menu-end">
                        <li>
                          <button
                            type="button"
                            class="dropdown-item"
                            disabled={deletingCommentIds.has(comment.id)}
                            on:click={() => removeComment(comment)}
                          ><i class="bi bi-trash3" aria-hidden="true"></i> {$_("m.f6fdbe48dc")}</button>
                        </li>
                      </ul>
                    </div>
                  {/if}
                </div>
              </div>
              {#if previewMode}
                <MarkdownViewer
                  className="note-comment-body-preview"
                  source={comment.body}
                />
              {:else}
                <textarea
                  id={`comment-body-${comment.id}`}
                  class="note-comment-body"
                  bind:value={comment.body}
                  on:input={() => markCommentDirty(comment)}
                  on:keydown={handleEditorKeydown}
                  on:blur={() => saveComment(comment)}
                  placeholder={$_("m.ee6540eb88")}
                  maxlength={MAX_ISSUE_COMMENT_LENGTH}
                  readonly={!editable || lockState === 'locked'}
                  use:autosize={comment.body}
                ></textarea>
              {/if}
            </div>
          {/each}
        {/if}
        {#if editable && lockState !== 'locked' && remoteIssue?.number && !previewMode}
          <button type="button" class="note-comment-add" on:click={addComment}>
            <i class="bi bi-plus-lg" aria-hidden="true"></i> {$_("m.7d3764e42e")}
          </button>
        {/if}
      </section>
    {/if}
    {#if lockState === 'locked' || lockPanelMode}
      <div class="note-lock-overlay">
        <form class="note-lock-panel" novalidate on:submit|preventDefault={submitLockPanel}>
          <i class={`bi ${lockPanelMode === 'lock' ? 'bi-lock' : 'bi-shield-lock'}`} aria-hidden="true"></i>
          <strong>{lockPanelMode === 'lock' ? '노트 잠금' : '잠긴 노트'}</strong>
          {#if lockPanelMode === 'reuse'}
            <BrailleSpinner active />
            <p>암호 재사용중...</p>
          {:else}
            <p>{lockPanelMode === 'lock'
              ? `모든 잠금 노트에 같은 6자리 숫자를 사용하세요. 숫자는 저장되지 않고 ${lockSessionLabel} 동안만 재사용되며, 잊으면 내용을 복구할 수 없습니다.`
              : '내용을 보려면 계정에서 사용한 6자리 숫자를 입력하세요.'}</p>
            <input
              id={`note-lock-pin-${editorId}`}
              class="form-control"
              type="text"
              inputmode="numeric"
              maxlength="6"
              autocomplete="off"
              bind:value={lockPanelPin}
              on:input={handleLockPinInput}
              aria-label="6자리 잠금 숫자"
              placeholder="000000"
            />
            <input type="submit" hidden disabled={lockPanelBusy || lockPanelPin.length !== 6} />
            {#if lockPanelError}<span class="note-lock-error">{lockPanelError}</span>{/if}
            {#if lockPanelMode === 'lock'}
              <div class="note-lock-actions">
                <button type="button" class="btn btn-outline-secondary" on:click={closeLockPanel}>취소</button>
                <button type="submit" class="btn btn-primary" disabled={lockPanelBusy || lockPanelPin.length !== 6}>
                  {lockPanelBusy ? '처리 중…' : '잠그기'}
                </button>
              </div>
            {/if}
          {/if}
        </form>
      </div>
    {/if}
    {#if activeLink}
      <a
        bind:this={linkTooltip}
        class="editor-link-tooltip"
        style={linkTooltipStyle}
        href={activeLink.url}
        target={newContextTarget}
        rel="noopener noreferrer"
        on:mousedown={keepLinkTooltipOpen}
        title={activeLink.url}
        aria-label={$_('dynamic.openLink', { values: { url: activeLink.url } })}
      >
        <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
        <span>{shortenMiddle(activeLink.url)}</span>
      </a>
    {/if}
  </div>
  </div>

  {#if viewedAttachment}
    <div
      class="attachment-viewer"
      bind:this={viewerElement}
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-label={$_("m.89d6d752c4")}
      on:click|self={closeViewer}
      on:keydown={handleViewerKeydown}
      on:keyup|stopPropagation
    >
      <div class="attachment-viewer-toolbar">
        <span>{viewerIndex + 1} / {attachments.length}</span>
        <span class="viewer-file-name">{viewedAttachment.name}</span>
        {#if previewUrls[viewedAttachment.path]}
          <a href={previewUrls[viewedAttachment.path]} download={viewedAttachment.name}>
            <i class="bi bi-download" aria-hidden="true"></i> {$_("m.a479c9c34e")}
          </a>
        {/if}
        {#if editable && !parseAttachmentPaths(body).includes(viewedAttachment.path)}
          <button type="button" on:click={() => insertAttachmentAtEnd(viewedAttachment)}>
            <i class="bi bi-file-earmark-plus" aria-hidden="true"></i> 본문삽입
          </button>
        {/if}
        {#if editable}
          <button type="button" on:click={() => removeAttachment(viewedAttachment)}>
            <i class="bi bi-trash3" aria-hidden="true"></i> {$_("m.f6fdbe48dc")}
          </button>
        {/if}
        <button type="button" on:click={closeViewer} aria-label={$_("m.acf7548d73")}>
          <i class="bi bi-x-lg" aria-hidden="true"></i> {$_("m.bbfa773e5a")}
        </button>
      </div>
      <div class="attachment-viewer-stage">
        {#if isImage(viewedAttachment)}
          {#if previewUrls[viewedAttachment.path]}
            <img src={previewUrls[viewedAttachment.path]} alt={viewedAttachment.name} />
          {:else}
            <span class="spinner-border" aria-label={$_("m.6adbafad55")}></span>
          {/if}
        {:else}
          <div class="attachment-file-view">
            <strong>{viewedAttachment.name}</strong>
            <span>{formatFileSize(viewedAttachment.size)}</span>
            {#if previewUrls[viewedAttachment.path]}
              <a class="btn btn-light" href={previewUrls[viewedAttachment.path]} download={viewedAttachment.name}>
                <i class="bi bi-download" aria-hidden="true"></i> {$_("m.774025da27")}
              </a>
            {:else}
              <span>{$_("m.4ee4f59c7c")}</span>
            {/if}
          </div>
        {/if}
      </div>
      {#if attachments.length > 1}
        <button type="button" class="viewer-nav viewer-prev" on:click={() => moveViewer(-1)} aria-label={$_("m.ad0c7c8ea7")}>
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
        </button>
        <button type="button" class="viewer-nav viewer-next" on:click={() => moveViewer(1)} aria-label={$_("m.57bc468d7d")}>
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>
      {/if}
    </div>
  {/if}
</div>
