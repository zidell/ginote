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
  import { loadPendingWork, pendingWorkScope, updatePendingWork } from './pending-work.js';
  import {
    ATTACHMENT_LINK_PLACEHOLDER,
    attachmentRawUrl,
    composeAttachmentLink,
    compressAttachmentLinks,
    expandAttachmentLinks,
    insertAttachmentLinks,
    managedAttachmentLinks,
    parseAttachmentPaths,
    removeAttachmentLink,
    stripManagedAttachmentBlocks,
    withManagedAttachmentBlock
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
  export let onTagSelect = () => {};
  export let onMove = () => {};
  export let onVoiceRecording = () => {};
  export let voiceComment = null;
  export let voiceBody = null;
  export let voiceCommentEdit = null;
  export let onVoiceBodyHandled = () => {};
  export let onVoiceCommentEditHandled = () => {};
  export let onBack = () => {};
  export let pinned = false;
  export let pinDisabled = false;
  export let onTogglePin = () => {};
  export let lockPin = '';
  export let lockSessionMinutes = 60;
  export let onSetLockSession = () => {};
  export let currentUserLogin = '';

  const DRAFTS_KEY = 'issue-note.drafts.v1';
  const LIST_PREVIEW_DEBOUNCE_MS = 500;
  const MAX_ATTACHMENTS = 30;
  const ATTACHMENT_DELETE_DELAY_MS = 5000;
  const VOICE_AUDIO_MARKUP = /<audio\s+controls\s+preload="metadata"\s+src="([^"]+)"[^>]*>[\s\S]*?<\/audio>/g;
  // 아직 번호가 없는 새 노트는 initialDraft.id(세션마다 고유)로 구분해야, 저장 도중
  // 리마운트되며 남겨진 이전 세션의 초안이 이후의 다른 새 노트에 잘못 복구되지 않는다.
  // 새로고침 직후처럼 initialDraft가 없을 때만 공용 'new' 키로 복구를 시도한다.
  const draftId = issue ? `issue.${issue.number}` : initialDraft?.id || 'new';
  const newContextTarget = externalLinkTarget();

  const initiallyLocked = isLockedTitle(issue?.title);
  let title = removeLockFromTitle(issue?.title || initialDraft?.title || '');
  let body = initiallyLocked
    ? issue?.body || ''
    : stripManagedAttachmentBlocks(issue?.body || initialDraft?.body || '');
  let preservedManagedAttachmentLinks = initiallyLocked
    ? []
    : managedAttachmentLinks(issue?.body || initialDraft?.body || '');
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
  let uploadingAttachments = [];
  let uploadBatchActive = false;
  let deletingPath = '';
  let pendingAttachmentDeletes = new Map();
  let attachmentDeleteTimers = new Map();
  let pendingWorkFlushPromise = null;
  let saveIdleResolvers = [];
  let commentSaveIdleResolvers = [];
  let recoveredPendingWork = false;
  let previewUrls = {};
  let voiceAudioPreviewUrls = {};
  let voiceAudioPreviewErrors = {};
  let viewerIndex = -1;
  let viewerElement;
  let editorScroll;
  let markdownViewer;
  let pendingPreviewScrollPosition = null;
  let previewScrollRestoreFrame = 0;
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
  let commentsLoaded = false;
  let savingCommentIds = new Set();
  let commentSaveFailedIds = new Set();
  let dirtyCommentIds = new Set();
  let deletingCommentIds = new Set();
  let error = '';
  let localTimer;
  let remoteTimer;
  let fileInput;
  let bodyInput;
  let bodyComposing = false;
  let bodyCompositionDirty = false;
  let bodyCompositionCommitted = false;
  let draftChangeTimer;
  let publishedListPreview = listPreviewSource(body);
  let toolbarTagPicker;
  let moreToolbarElement;
  let issueLinkElement;
  let handledFocusRequest = 0;
  let mobileTagPicker;
  let inlineTagPickerOpen = false;
  let linkTooltip;
  let linkTooltipFrame = 0;
  let activeLink = null;
  let linkTooltipStyle = '';
  let replacePanelOpen = false;
  let replaceSearch = '';
  let replaceWith = '';
  let replaceSearchInput;
  let replaceReturnFocus;
  let mounted = false;
  let handledRefreshRequest = 0;
  let handledExternalPasteRequest = 0;
  let handledVoiceCommentId = 0;
  let handledVoiceBodyId = 0;
  let handledVoiceCommentEditId = 0;

  $: fontStack = editorFontStack(font);
  $: displayedLabels = visibleLabelNames(labels);
  $: visibleAvailableLabels = filterVisibleLabels(availableLabels);
  $: desiredPinned = pinned || Boolean(issue?.labels?.some((label) => isPinLabel(label)));
  $: if (mounted && remoteIssue?.number) syncPinLabelToParent();
  $: viewedAttachment = viewerIndex >= 0 ? attachments[viewerIndex] : null;
  $: displayBody = compressAttachmentLinks(body, repo);
  $: previewBody = expandAttachmentLinks(displayBody, repo);
  $: previewImageSources = Object.fromEntries(
    attachments
      .filter(isImage)
      .map((attachment) => [attachmentRawUrl(repo, attachment.path), previewUrls[attachment.path]])
      .filter(([, source]) => source)
  );
  $: replacementAnalysis = analyzeReplacement(displayBody, replaceSearch, replaceWith);
  $: hasAttachmentRefs = parseAttachmentPaths(body).length > 0;
  $: editable = !archived && !readOnly;
  $: canPreview = lockState !== 'locked' && !lockPanelMode;
  $: compactStatus = !editable
    ? $_("m.601dcc1c87")
    : saveFailed
      ? $_("m.0a44446762")
      : '';
  $: showSaveStatus = !editable || saveFailed || saving;
  $: hasPendingWork = dirty
    || pendingAttachmentDeletes.size > 0
    || dirtyCommentIds.size > 0
    || saving
    || savingCommentIds.size > 0;
  $: if (remoteIssue?.number && lockState !== 'locked' && reconciledIssueNumber !== remoteIssue.number) {
    reconciledIssueNumber = remoteIssue.number;
    reconcileIssueAttachments(remoteIssue.number);
  }
  $: if (remoteIssue?.number && commentsIssueNumber !== remoteIssue.number) {
    commentsIssueNumber = remoteIssue.number;
    commentsLoaded = false;
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
  $: if (replacePanelOpen && lockState === 'locked') closeReplacePanel();
  $: if (voiceComment?.id > handledVoiceCommentId) {
    handledVoiceCommentId = voiceComment.id;
    if (voiceComment.issueNumber === remoteIssue?.number) {
      comments = [...comments, voiceComment.comment];
      commentsLoaded = true;
    }
  }
  $: if (voiceBody?.id > handledVoiceBodyId) {
    handledVoiceBodyId = voiceBody.id;
    if (voiceBody.issueNumber === remoteIssue?.number) {
      if (voiceBody.attachment) replaceAttachments([...attachments, voiceBody.attachment]);
      const insertedText = voiceTextWithSpacing(displayBody, voiceBody, voiceBody.body);
      const nextDisplayBody = replaceVoiceTarget(displayBody, voiceBody, insertedText);
      updateBodyFromTextarea(nextDisplayBody);
      changed();
      // 음성 화면에서 돌아온 직후 모바일의 뒤로 가기를 누르면 일반 자동저장
      // 타이머가 실행되기 전에 편집기가 사라질 수 있다. 전사문은 삽입과 동시에
      // 저장을 시작해, 목록으로 즉시 돌아가도 다음 진입에서 이전 본문이 보이지
      // 않게 한다. returnToList()와 onDestroy()는 이 진행 중인 저장도 기다린다.
      void flushPendingWork({
        reason: 'voice-body',
        allowPaused: true,
        force: true,
        includeAttachments: false,
        includeComments: false
      });
      // 부모가 이벤트를 소비했다고 표시해야 이 편집기가 다시 마운트되어도
      // 같은 음성 본문을 한 번 더 덧붙이지 않는다.
      onVoiceBodyHandled(voiceBody.id);
    }
  }
  $: if (voiceCommentEdit?.id > handledVoiceCommentEditId) {
    handledVoiceCommentEditId = voiceCommentEdit.id;
    if (voiceCommentEdit.issueNumber === remoteIssue?.number) {
      const comment = comments.find((item) => item.id === voiceCommentEdit.commentId);
      if (comment) {
        const editableBody = commentTextForEditing(comment.body);
        const insertedText = voiceTextWithSpacing(editableBody, voiceCommentEdit, voiceCommentEdit.body);
        const nextBody = replaceVoiceTarget(editableBody, voiceCommentEdit, insertedText);
        const existingAudioMarkup = voiceAudioMarkup(comment.body);
        comment.body = voiceCommentEdit.attachmentLink
          ? `${nextBody.trimEnd()}${existingAudioMarkup ? '\n\n' : ''}${existingAudioMarkup}${existingAudioMarkup ? '\n\n' : ''}${voiceCommentEdit.attachmentLink}`
          : `${nextBody}${existingAudioMarkup ? `\n\n${existingAudioMarkup}` : ''}`;
        comments = comments;
        markCommentDirty(comment);
        tick().then(() => {
          const input = document.getElementById(`comment-body-${comment.id}`);
          input?.focus();
          const position = Math.min(input?.value.length || 0, (voiceCommentEdit.selectionStart || 0) + insertedText.length);
          input?.setSelectionRange(position, position);
        });
      }
      onVoiceCommentEditHandled(voiceCommentEdit.id);
    }
  }
  $: if (mounted) comments.forEach((comment) => commentAudioSources(comment.body).forEach(loadCommentAudioPreview));

  onMount(() => {
    const recovered = !editable || ignoreRecoveredDraft ? null : readDraft();
    restorePendingWork();
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
    if (recoveredPendingWork) {
      void flushPendingWork({ reason: 'recovery', allowPaused: true });
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
    if (becamePaused && hasPendingWork) flushPendingWork({ reason: 'pause', allowPaused: true });
  });

  onDestroy(() => {
    destroyed = true;
    if (linkTooltipFrame) cancelAnimationFrame(linkTooltipFrame);
    linkTooltipFrame = 0;
    cancelPreviewScrollRestore();
    if (dirty) persistLocalDraft();
    clearInterval(localTimer);
    clearTimeout(remoteTimer);
    clearTimeout(draftChangeTimer);
    clearAttachmentDeleteTimers();
    clearTimeout(lockReuseTimer);
    window.removeEventListener('beforeunload', handlePageExit);
    window.removeEventListener('pagehide', handlePageExit);
    window.removeEventListener('keydown', handleMoreToolbarEscape, true);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    persistPendingWork();
    if (hasPendingWork) void flushPendingWork({ reason: 'destroy', allowPaused: true, requestOptions: { keepalive: true } });
    Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url));
    previewUrls = {};
    Object.values(voiceAudioPreviewUrls).forEach((url) => URL.revokeObjectURL(url));
    voiceAudioPreviewUrls = {};
    voiceAudioPreviewErrors = {};
  });

  function draftStore() {
    try {
      return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function readDraft() {
    const pendingDraft = loadPendingWork(repo, issue?.number || remoteIssue?.number)?.noteDraft;
    return pendingDraft || draftStore()[repo]?.[draftId] || null;
  }

  function persistLocalDraft() {
    if (!dirty) {
      persistPendingWork();
      return;
    }
    if (lockState !== 'plain') {
      removeLocalDraft();
      return;
    }
    const store = draftStore();
    store[repo] ||= {};
    const draft = { title, body, labels, savedAt: Date.now() };
    store[repo][draftId] = draft;
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(store));
    if (issue?.number || remoteIssue?.number) {
      updatePendingWork(repo, issue?.number || remoteIssue?.number, { noteDraft: draft });
    }
  }

  function removeLocalDraft() {
    const store = draftStore();
    if (store[repo]) {
      delete store[repo][draftId];
      if (!Object.keys(store[repo]).length) delete store[repo];
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(store));
    }
    if (issue?.number || remoteIssue?.number) {
      updatePendingWork(repo, issue?.number || remoteIssue?.number, { noteDraft: null });
    }
  }

  function pendingWorkRecord() {
    const issueNumber = issue?.number || remoteIssue?.number;
    const scope = pendingWorkScope(repo, issueNumber);
    if (!scope) return null;
    return loadPendingWork(repo, issueNumber);
  }

  function pendingAttachmentRecords() {
    return [...pendingAttachmentDeletes.values()].map(({ attachment, expiresAt }) => ({
      attachment,
      expiresAt
    }));
  }

  function pendingCommentRecords() {
    if (lockState !== 'plain') return [];
    return comments
      .filter((comment) => dirtyCommentIds.has(comment.id))
      .map((comment) => ({
        id: comment.id,
        body: comment.body,
        author: comment.author,
        avatarUrl: comment.avatarUrl,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        isNew: Boolean(comment.isNew)
      }));
  }

  function persistPendingWork() {
    const issueNumber = issue?.number || remoteIssue?.number;
    if (!issueNumber) return;
    const previous = pendingWorkRecord();
    updatePendingWork(repo, issueNumber, {
      attachmentDeletes: pendingAttachmentRecords(),
      // 댓글 GET이 끝나기 전에는 아직 컴포넌트가 어떤 댓글을 알고 있는지
      // 모르므로, 복구 큐의 댓글 초안을 빈 배열로 덮어쓰지 않는다.
      commentDrafts: commentsLoaded
        ? pendingCommentRecords()
        : previous?.commentDrafts || []
    });
  }

  function restorePendingWork() {
    const record = pendingWorkRecord();
    const restored = Array.isArray(record?.attachmentDeletes)
      ? record.attachmentDeletes.filter((item) => item?.attachment?.path)
      : [];
    if (restored.length) {
      pendingAttachmentDeletes = new Map(
        restored.map(({ attachment, expiresAt }) => [attachment.path, {
          attachment,
          expiresAt: Number(expiresAt) || Date.now()
        }])
      );
    }
    recoveredPendingWork = Boolean(record?.noteDraft)
      || restored.length > 0
      || Boolean(record?.commentDrafts?.length);
  }

  function restorePendingComments(nextComments) {
    const drafts = pendingWorkRecord()?.commentDrafts;
    if (!Array.isArray(drafts) || !drafts.length || lockState !== 'plain') return nextComments;

    const merged = [...nextComments];
    for (const draft of drafts) {
      const index = merged.findIndex((comment) => comment.id === draft.id);
      if (index >= 0) merged[index] = { ...merged[index], body: draft.body };
      else if (draft.isNew) merged.push(draft);
      dirtyCommentIds.add(draft.id);
    }
    dirtyCommentIds = dirtyCommentIds;
    return merged;
  }

  function clearAttachmentDeleteTimers() {
    for (const timer of attachmentDeleteTimers.values()) clearTimeout(timer);
    attachmentDeleteTimers = new Map();
  }

  function resolveSaveIdle() {
    if (saving) return;
    const resolvers = saveIdleResolvers;
    saveIdleResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  function waitForSaveIdle() {
    if (!saving) return Promise.resolve();
    return new Promise((resolve) => saveIdleResolvers.push(resolve));
  }

  function resolveCommentSaveIdle() {
    if (savingCommentIds.size) return;
    const resolvers = commentSaveIdleResolvers;
    commentSaveIdleResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  function waitForCommentSaves() {
    if (!savingCommentIds.size) return Promise.resolve();
    return new Promise((resolve) => commentSaveIdleResolvers.push(resolve));
  }

  function attachmentWorkEntries(paths = null) {
    const requestedPaths = paths ? new Set(paths) : null;
    return [...pendingAttachmentDeletes.entries()]
      .filter(([path]) => !requestedPaths || requestedPaths.has(path))
      .map(([path, entry]) => ({ path, ...entry }));
  }

  function scheduleAttachmentDeleteCommit(path, expiresAt) {
    const existingTimer = attachmentDeleteTimers.get(path);
    if (existingTimer) clearTimeout(existingTimer);
    const delay = Math.max(0, expiresAt - Date.now());
    const timer = setTimeout(() => {
      attachmentDeleteTimers.delete(path);
      void flushPendingWork({
        reason: 'attachment-timeout',
        attachmentPaths: [path]
      });
    }, delay);
    attachmentDeleteTimers = new Map(attachmentDeleteTimers).set(path, timer);
  }

  function removeAttachmentFromView(attachment) {
    orphanedAttachments = orphanedAttachments.filter((item) => item.path !== attachment.path);
    if (previewUrls[attachment.path]) URL.revokeObjectURL(previewUrls[attachment.path]);
    const nextPreviewUrls = { ...previewUrls };
    delete nextPreviewUrls[attachment.path];
    previewUrls = nextPreviewUrls;
    const removedIndex = attachments.findIndex((item) => item.path === attachment.path);
    replaceAttachments(attachments.filter((item) => item.path !== attachment.path));
    if (viewerIndex === removedIndex) closeViewer();
    else if (viewerIndex > removedIndex) viewerIndex -= 1;
  }

  async function flushPendingWork({
    reason = 'manual',
    allowPaused = true,
    requestOptions = {},
    attachmentPaths = null,
    force = false,
    includeAttachments = true,
    includeComments = true
  } = {}) {
    if (pendingWorkFlushPromise) {
      await pendingWorkFlushPromise;
      const hasRequestedWork = includeAttachments && (attachmentPaths
        ? attachmentPaths.some((path) => pendingAttachmentDeletes.has(path))
        : pendingAttachmentDeletes.size > 0);
      const hasRequestedComments = includeComments && dirtyCommentIds.size > 0;
      if (hasRequestedWork || force || dirty || hasRequestedComments) {
        return flushPendingWork({
          reason,
          allowPaused,
          requestOptions,
          attachmentPaths,
          force,
          includeAttachments,
          includeComments
        });
      }
      return true;
    }

    const run = (async () => {
      const entries = includeAttachments ? attachmentWorkEntries(attachmentPaths) : [];
      let failed = false;

      for (const { path } of entries) {
        const timer = attachmentDeleteTimers.get(path);
        if (timer) clearTimeout(timer);
      }

      if (entries.length) {
        let nextBody = body;
        for (const { attachment } of entries) {
          nextBody = removeAttachmentLink(
            nextBody,
            composeAttachmentLink(repo, attachment)
          );
        }
        if (nextBody !== body) {
          body = nextBody;
          changed();
          clearTimeout(remoteTimer);
        }
      }

      await waitForSaveIdle();
      if (dirty || force) {
        const saveSucceeded = await saveRemote(force, allowPaused, requestOptions);
        await waitForSaveIdle();
        if (saveFailed || !saveSucceeded) return false;
      }

      for (const { path, attachment } of entries) {
        if (!pendingAttachmentDeletes.has(path)) continue;
        deletingPath = path;
        try {
          await deleteAttachment(token, repo, attachment);
          const nextPending = new Map(pendingAttachmentDeletes);
          nextPending.delete(path);
          pendingAttachmentDeletes = nextPending;
          removeAttachmentFromView(attachment);
          persistPendingWork();
        } catch (deleteReason) {
          if (deleteReason?.status === 404) {
            const nextPending = new Map(pendingAttachmentDeletes);
            nextPending.delete(path);
            pendingAttachmentDeletes = nextPending;
            removeAttachmentFromView(attachment);
            persistPendingWork();
          } else {
            failed = true;
            error = deleteReason?.message || $_("m.f8a2b33cc2");
          }
        } finally {
          deletingPath = '';
        }
      }

      persistPendingWork();
      if (failed && !destroyed) scheduleRemoteSave(15000);
      if (includeComments) {
        await waitForCommentSaves();
        const dirtyComments = [...dirtyCommentIds]
          .map((id) => comments.find((comment) => comment.id === id))
          .filter(Boolean);
        if (dirtyComments.length) {
          await Promise.all(dirtyComments.map((comment) => saveComment(comment, true)));
          await waitForCommentSaves();
        }
      }

      if (failed) return false;
      return (!includeAttachments || !pendingAttachmentDeletes.size)
        && !dirty
        && (!includeComments || !dirtyCommentIds.size);
    })();

    pendingWorkFlushPromise = run;
    try {
      return await run;
    } finally {
      if (pendingWorkFlushPromise === run) pendingWorkFlushPromise = null;
    }
  }

  function flushRemoteSave(requestOptions = {}) {
    if (!hasPendingWork || archived) return;
    persistLocalDraft();
    if (refreshing) return;
    clearTimeout(remoteTimer);
    return flushPendingWork({
      reason: 'save',
      allowPaused: true,
      requestOptions,
      includeAttachments: false,
      includeComments: false
    });
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
      void flushPendingWork({
        reason: 'shortcut',
        allowPaused: true,
        force: true,
        includeComments: false
      });
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      void flushPendingWork({
        reason: 'visibility',
        allowPaused: true,
        includeAttachments: false
      });
    }
  }

  function handlePageExit() {
    persistLocalDraft();
    void flushPendingWork({
      reason: 'page-exit',
      allowPaused: true,
      requestOptions: { keepalive: true }
    });
  }

  function changed({ debounceListUpdate = false, listPreviewChanged = true } = {}) {
    if (!editable || lockState === 'locked') return;
    if (titleMode === 'first-line') title = automaticTitle(body);
    dirty = true;
    saveFailed = false;
    revision += 1;
    error = '';
    notifyDraftChange({ debounce: debounceListUpdate, onlyWhenListPreviewChanges: !listPreviewChanged });
    scheduleRemoteSave();
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function replacementPattern(pattern) {
    const value = String(pattern || '');
    const match = value.match(/^\/([\s\S]*)\/([a-z]*)$/);
    if (!match) return { source: escapeRegex(value), flags: 'g', isRegex: false };

    const flags = match[2].includes('g') ? match[2] : `${match[2]}g`;
    return { source: match[1], flags, isRegex: true };
  }

  function countReplacementMatches(text, regex) {
    let count = 0;
    for (const segment of String(text || '').split(ATTACHMENT_LINK_PLACEHOLDER)) {
      regex.lastIndex = 0;
      for (const _match of segment.matchAll(regex)) count += 1;
    }
    return count;
  }

  function replaceOutsideAttachmentPlaceholders(text, regex, replacement, isRegex) {
    return String(text || '')
      .split(ATTACHMENT_LINK_PLACEHOLDER)
      .map((segment) => {
        regex.lastIndex = 0;
        return isRegex
          ? segment.replace(regex, replacement)
          : segment.replace(regex, () => replacement);
      })
      .join(ATTACHMENT_LINK_PLACEHOLDER);
  }

  function replacementExample(text, regex, replacement, isRegex) {
    let previewRegex;
    try {
      previewRegex = new RegExp(regex.source, regex.flags.replace('g', '').replace('y', ''));
    } catch {
      return null;
    }

    const source = String(text || '');
    for (const segment of source.split(ATTACHMENT_LINK_PLACEHOLDER)) {
      const firstMatch = segment.match(previewRegex);
      if (!firstMatch) continue;

      const matchIndex = firstMatch.index || 0;
      const prefix = segment.slice(0, matchIndex);
      const suffix = segment.slice(matchIndex + firstMatch[0].length);
      const preview = isRegex
        ? segment.replace(previewRegex, replacement)
        : segment.replace(previewRegex, () => replacement);
      const hasPrefix = preview.startsWith(prefix);
      const hasSuffix = !suffix || preview.endsWith(suffix);
      const replaced = hasPrefix && hasSuffix
        ? preview.slice(prefix.length, suffix ? preview.length - suffix.length : undefined)
        : replacement;
      return { match: firstMatch[0], replacement: replaced };
    }
    return null;
  }

  function analyzeReplacement(text, pattern, replacement = '') {
    if (!pattern) return { count: 0, error: '', regex: null };

    const parsed = replacementPattern(pattern);
    if (parsed.isRegex && !parsed.source) {
      return { count: 0, error: $_("m.8f1b9d0a2c"), regex: null };
    }

    let regex;
    try {
      regex = new RegExp(parsed.source, parsed.flags);
    } catch {
      return { count: 0, error: $_("m.8f1b9d0a2c"), regex: null };
    }

    const count = countReplacementMatches(text, regex);
    const example = count
      ? replacementExample(text, regex, replacement, parsed.isRegex)
      : { match: pattern, replacement };
    return {
      count,
      error: '',
      regex,
      isRegex: parsed.isRegex,
      example
    };
  }

  function openReplacePanel() {
    if (!canUseNoteShortcut('e')) return;
    replaceReturnFocus = document.activeElement;
    toolbarTagPicker?.close?.();
    mobileTagPicker?.close?.();
    inlineTagPickerOpen = false;
    hideMoreToolbarDropdown();
    replacePanelOpen = true;
    tick().then(() => replaceSearchInput?.focus());
  }

  function closeReplacePanel() {
    if (!replacePanelOpen) return;
    replacePanelOpen = false;
    const focusTarget = replaceReturnFocus;
    replaceReturnFocus = null;
    tick().then(() => {
      if (focusTarget?.isConnected) focusWithoutScrolling(focusTarget);
    });
  }

  function handleReplaceDialogKeydown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeReplacePanel();
  }

  function applyReplacement() {
    if (!canUseNoteShortcut('e')) return;
    const analysis = analyzeReplacement(displayBody, replaceSearch, replaceWith);
    if (analysis.error || !analysis.regex || !analysis.count) return;

    const nextDisplayBody = replaceOutsideAttachmentPlaceholders(
      displayBody,
      analysis.regex,
      replaceWith,
      analysis.isRegex
    );
    const nextBody = expandAttachmentLinks(nextDisplayBody, repo);
    if (nextBody !== body) {
      body = nextBody;
      changed();
    }
    closeReplacePanel();
  }

  function listPreviewSource(value) {
    const text = String(value || '');
    let lineBreaks = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== '\n') continue;
      lineBreaks += 1;
      if (lineBreaks === 2) return text.slice(0, index);
    }
    return text;
  }

  function notifyDraftChange({ debounce = false, onlyWhenListPreviewChanges = false } = {}) {
    const preview = listPreviewSource(body);
    if (onlyWhenListPreviewChanges && preview === publishedListPreview) return;

    const publish = () => {
      draftChangeTimer = null;
      publishedListPreview = listPreviewSource(body);
      onDraftChange(draftPayload());
    };

    clearTimeout(draftChangeTimer);
    if (debounce) draftChangeTimer = setTimeout(publish, LIST_PREVIEW_DEBOUNCE_MS);
    else publish();
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
    remoteTimer = setTimeout(() => flushRemoteSave(), delay);
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

  function bodyWithManagedAttachmentLinks(bodyText) {
    const cleanBody = stripManagedAttachmentBlocks(bodyText);
    const manuallyLinkedPaths = new Set(parseAttachmentPaths(cleanBody));
    const deletingPaths = new Set(pendingAttachmentDeletes.keys());
    const links = attachments.length
      ? attachments
        .filter((attachment) => !manuallyLinkedPaths.has(attachment.path) && !deletingPaths.has(attachment.path))
        .map((attachment) => composeAttachmentLink(repo, attachment))
      : preservedManagedAttachmentLinks;
    return withManagedAttachmentBlock(cleanBody, links);
  }

  async function noteForRemote(note) {
    const remoteBody = expandAttachmentLinks(bodyWithManagedAttachmentLinks(note.body), repo);
    if (lockState === 'plain') return { ...note, body: remoteBody };
    if (lockState === 'locked') {
      return { ...note, title: addLockToTitle(note.title), body: encryptedBody };
    }
    if (!activeLockPin) throw new Error('잠금 세션이 만료되었습니다.');
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
    await flushPendingWork({ reason: 'lock', allowPaused: true, force: true });
  }

  async function revealLockedNote(pin, automatic = false) {
    if (!encryptedBody || lockState !== 'locked') return;
    lockPanelBusy = true;
    try {
      const contextIssueNumber = issue?.number || remoteIssue?.number;
      const decryptedBody = await decryptLockedBody(encryptedBody, pin, contextIssueNumber);
      preservedManagedAttachmentLinks = managedAttachmentLinks(decryptedBody);
      body = stripManagedAttachmentBlocks(decryptedBody);
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
        await flushPendingWork({ reason: 'lock-session-expiry', allowPaused: true, force: true });
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
    await flushPendingWork({ reason: 'unlock', allowPaused: true, force: true });
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
    body = refreshedLocked ? refreshed.body || '' : stripManagedAttachmentBlocks(refreshed.body || '');
    preservedManagedAttachmentLinks = refreshedLocked ? [] : managedAttachmentLinks(refreshed.body || '');
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
    if (archived) return false;
    if (saving) {
      const hasNewerContent = noteSignature(currentNote()) !== activeSavingSignature;
      if (force && hasNewerContent) {
        forceSaveQueued = true;
        forceSaveAllowPaused = forceSaveAllowPaused || allowPaused;
      }
      return false;
    }
    if (!force && !dirty) return true;
    if (paused && !allowPaused) {
      if (!force) scheduleRemoteSave();
      return false;
    }
    persistLocalDraft();
    const note = currentNote();
    if (!note.title) {
      return false;
    }
    const signature = noteSignature(note);
    if (!force && signature === lastRemoteSignature) {
      dirty = false;
      removeLocalDraft();
      return true;
    }

    const savingRevision = revision;
    activeSavingSignature = signature;
    saving = true;
    saveFailed = false;
    error = '';
    let saveSucceeded = false;

    try {
      let targetIssue = issue || await resolveRemoteIssue();
      let reopenRequested = false;
      let previousIssue = null;
      if (targetIssue?.number && issue && !destroyed) {
        const prepared = await prepareExistingIssueSave(targetIssue);
        if (prepared.cancelled) return false;
        targetIssue = prepared.targetIssue;
        reopenRequested = prepared.reopen;
        previousIssue = prepared.previousIssue;
      }
      if (destroyed && issue) return false;

      const knownNames = new Set(visibleAvailableLabels.map((label) => label.name.toLocaleLowerCase()));
      const missingNames = labels.filter((name) => !isPinLabel(name) && !knownNames.has(name.toLocaleLowerCase()));
      const createdLabels = await Promise.all(
        missingNames.map((name) => createLabel(token, repo, name, requestOptions))
      );
      if (createdLabels.length) {
        availableLabels = [...availableLabels, ...createdLabels];
        onLabelsAvailable(createdLabels);
      }
      if (destroyed && issue) return false;

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
      saveSucceeded = true;

      if (targetIssue && !reopenRequested) {
        const lateResolution = await resolveLateClosedSave(
          saved,
          previousIssue,
          remoteNote,
          requestOptions
        );
        if (lateResolution.cancelled) return false;
        saved = lateResolution.saved;
      }

      const hasNewerChanges = savingRevision !== revision || noteSignature(currentNote()) !== signature;
      // 목록으로 즉시 돌아간 뒤에도 기존 노트의 백그라운드 저장 결과는 목록
      // 캐시에 반영해야 한다. 새 노트는 부모가 이미 번호 할당을 처리했을 수
      // 있으므로 onCreated는 파괴 뒤에 호출하지 않는다.
      if (destroyed) {
        if (issue) onSaved(saved, hasNewerChanges ? draftPayload() : null);
        return saveSucceeded;
      }

      remoteIssue = saved;
      if (lockState !== 'plain') encryptedBody = saved.body || encryptedBody;
      lastRemoteSignature = signature;
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
        void saveRemote(true, queuedAllowPaused);
      } else resolveSaveIdle();
    }
    return saveSucceeded;
  }

  function handleBackgroundRefreshRequest() {
    if (refreshRequest <= handledRefreshRequest) return;
    handledRefreshRequest = refreshRequest;
    if (!hasPendingWork && !saving) refreshIssue(true);
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
    if (background && hasPendingWork) {
      onRefreshStateChange(false);
      return;
    }
    if (!background && dirty && !confirm($_("m.37533033a1"))) {
      return;
    }

    if (!background && pendingAttachmentDeletes.size) {
      const flushed = await flushPendingWork({ reason: 'refresh', allowPaused: true, force: true });
      if (!flushed) return;
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
    const uploadItems = [];
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        error = $_('dynamic.fileTooLarge', { values: { name: file.name } });
        continue;
      }
      uploadItems.push({ id: crypto.randomUUID(), file, name: file.name });
    }
    if (!uploadItems.length) {
      if (fileInput) fileInput.value = '';
      uploadBatchActive = false;
      return;
    }

    // 여러 파일을 고르면 타일을 먼저 모두 확보한다. 실제 업로드가 순서대로
    // 끝나더라도 목록이 한 항목씩 늦게 생기지 않고 각 타일의 로딩만 해제된다.
    uploadingAttachments = [...uploadingAttachments, ...uploadItems];
    uploading = uploadingAttachments.length;
    const uploadedAttachments = [];
    for (const item of uploadItems) {
      error = '';
      try {
        const attachment = await uploadAttachment(token, repo, targetIssue.number, item.file);
        uploadedAttachments.push(attachment);
        if (!destroyed) {
          replaceAttachments([...attachments, attachment]);
          retainPreviewUrl(attachment.path, URL.createObjectURL(item.file));
        }
      } catch (reason) {
        error = reason?.status === 403
          ? $_("m.8c4abbd3b6")
          : reason?.message || $_("m.d5ca50a853");
      } finally {
        uploadingAttachments = uploadingAttachments.filter(({ id }) => id !== item.id);
        uploading = uploadingAttachments.length;
      }
    }
    if (uploadedAttachments.length) {
      changed();
      clearTimeout(remoteTimer);
      await flushPendingWork({ reason: 'attachment-upload', allowPaused: true, force: true });
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

  function updateBodyFromTextarea(value) {
    const previousPreview = listPreviewSource(body);
    const nextBody = expandAttachmentLinks(value, repo);
    const bodyChanged = nextBody !== body;
    if (bodyChanged) {
      body = nextBody;
      if (titleMode === 'first-line') title = automaticTitle(body);
    }
    return { bodyChanged, listPreviewChanged: listPreviewSource(nextBody) !== previousPreview };
  }

  function handleBodyCompositionStart() {
    bodyComposing = true;
    bodyCompositionDirty = false;
    bodyCompositionCommitted = false;
    hideLinkTooltip();
  }

  function handleBodyCompositionEnd(event) {
    const { bodyChanged, listPreviewChanged } = updateBodyFromTextarea(event.currentTarget.value);
    bodyComposing = false;
    if (bodyCompositionDirty || bodyChanged) {
      changed({ debounceListUpdate: true, listPreviewChanged });
      bodyCompositionCommitted = true;
    }
    bodyCompositionDirty = false;
    updateLinkTooltip(event);
  }

  function handleBodyInput(event) {
    const textarea = event.currentTarget;
    displayBody = textarea.value;
    const composing = bodyComposing || event.isComposing;
    const { bodyChanged, listPreviewChanged } = updateBodyFromTextarea(textarea.value);

    if (composing) {
      bodyCompositionDirty = bodyCompositionDirty || bodyChanged;
      if (bodyChanged) {
        dirty = true;
        saveFailed = false;
        revision += 1;
        error = '';
      }
      // 새 노트는 번호 할당 응답이 조합 중에 도착해도 최신 조합문을
      // 잃지 않도록 부모의 pendingNote에만 반영한다. 기존 노트는
      // 조합 중 부모 렌더를 유발하지 않는다.
      if (bodyChanged && !issue) notifyDraftChange({ debounce: true, onlyWhenListPreviewChanges: !listPreviewChanged });
      return;
    }

    if (bodyCompositionCommitted && !bodyChanged) {
      bodyCompositionCommitted = false;
      return;
    }
    bodyCompositionCommitted = false;
    changed({ debounceListUpdate: true, listPreviewChanged });
  }

  function updateLinkTooltip(event) {
    if (bodyComposing || event?.isComposing) {
      hideLinkTooltip();
      return;
    }
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
    if (linkTooltipFrame) cancelAnimationFrame(linkTooltipFrame);
    linkTooltipFrame = requestAnimationFrame(() => {
      linkTooltipFrame = 0;
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
    if (linkTooltipFrame) cancelAnimationFrame(linkTooltipFrame);
    linkTooltipFrame = 0;
    activeLink = null;
    linkTooltipStyle = '';
  }

  function handleBodyBlur(event) {
    if (bodyComposing || bodyCompositionDirty) handleBodyCompositionEnd(event);
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

  function isAudio(attachment) {
    return attachment?.type?.startsWith('audio/')
      || /\.(m4a|mp3|mp4|oga|ogg|opus|wav|webm)$/i.test(attachment?.name || '');
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
      const downloaded = await downloadAttachment(token, repo, attachment);
      const blob = isAudio(attachment) ? withAudioMimeType(downloaded, attachment.name) : downloaded;
      if (!isCurrentAttachment(attachment.path)) return '';
      return retainPreviewUrl(attachment.path, URL.createObjectURL(blob));
    } catch (reason) {
      error = reason?.message || $_("m.4a71ec7a03");
      return '';
    }
  }

  function removeAttachment(attachment) {
    if (!editable || deletingPath || pendingAttachmentDeletes.has(attachment.path)) return;
    const expiresAt = Date.now() + ATTACHMENT_DELETE_DELAY_MS;
    pendingAttachmentDeletes = new Map(pendingAttachmentDeletes).set(attachment.path, {
      attachment: { ...attachment },
      expiresAt
    });
    error = '';
    persistPendingWork();
    scheduleAttachmentDeleteCommit(attachment.path, expiresAt);
  }

  function cancelAttachmentDeletion(attachment) {
    const entry = pendingAttachmentDeletes.get(attachment.path);
    if (!entry || deletingPath === attachment.path) return;
    const timer = attachmentDeleteTimers.get(attachment.path);
    if (timer) clearTimeout(timer);
    const nextTimers = new Map(attachmentDeleteTimers);
    nextTimers.delete(attachment.path);
    attachmentDeleteTimers = nextTimers;

    const nextPending = new Map(pendingAttachmentDeletes);
    nextPending.delete(attachment.path);
    pendingAttachmentDeletes = nextPending;
    error = '';
    persistPendingWork();
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
      preservedManagedAttachmentLinks = [];
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
    commentsLoaded = false;
    loadingComments = Number(remoteIssue?.comments || 0) > 0;
    try {
      const nextComments = await listIssueComments(token, repo, issueNumber);
      if (destroyed || remoteIssue?.number !== issueNumber) return;
      const decryptedComments = lockState === 'unlocked'
        ? await decryptCommentBodies(nextComments, activeLockPin, issue?.number || remoteIssue?.number)
        : nextComments;
      comments = restorePendingComments(decryptedComments);
      commentsLoaded = true;
      if (dirtyCommentIds.size) void flushPendingWork({ reason: 'comment-recovery', allowPaused: true });
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
    persistPendingWork();
  }

  function discardNewComment(comment) {
    comments = comments.filter((item) => item.id !== comment.id);
    dirtyCommentIds.delete(comment.id);
    commentSaveFailedIds.delete(comment.id);
    persistPendingWork();
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
      persistPendingWork();
      if (savedSuccessfully && dirtyCommentIds.has(comment.id) && !destroyed) {
        const latestComment = comments.find((item) => item.id === comment.id);
        if (latestComment) saveComment(latestComment);
      }
      resolveCommentSaveIdle();
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

  function voiceTargetFor(input, type, extras = {}) {
    const source = input?.value ?? '';
    const appendAtEnd = extras.appendAtEnd === true;
    // 본문에 포커스가 없으면 textarea가 마지막으로 기억한 selectionStart는
    // 실제 커서가 아니다. 끝의 공백까지 선택해 빈 줄을 새로 만든다.
    const selectionStart = appendAtEnd
      ? source.trimEnd().length
      : Math.max(0, Math.min(input?.selectionStart ?? source.length, source.length));
    const selectionEnd = appendAtEnd
      ? source.length
      : Math.max(selectionStart, Math.min(input?.selectionEnd ?? selectionStart, source.length));
    const selectedText = appendAtEnd ? '' : source.slice(selectionStart, selectionEnd);
    const preview = selectedText
      ? { type: 'replace', selectedText: shortenMiddle(selectedText, 64) }
      : {
          type: 'insert',
          before: voicePreviewBefore(source.slice(0, selectionStart)),
          after: voicePreviewAfter(source.slice(selectionEnd))
        };
    return { type, selectionStart, selectionEnd, preview, ...extras };
  }

  function voicePreviewBefore(value) {
    const characters = Array.from(value);
    return `${characters.length > 28 ? '…' : ''}${characters.slice(-28).join('')}`;
  }

  function voicePreviewAfter(value) {
    const characters = Array.from(value);
    return `${characters.slice(0, 28).join('')}${characters.length > 28 ? '…' : ''}`;
  }

  function voiceTextWithSpacing(source, target, transcript) {
    const value = String(source || '');
    const start = Math.max(0, Math.min(target?.selectionStart ?? value.length, value.length));
    const end = Math.max(start, Math.min(target?.selectionEnd ?? start, value.length));
    const text = String(transcript || '').trim();
    if (target?.appendAtEnd) return start > 0 ? `\n\n${text}` : text;
    const needsSpaceBefore = start > 0 && !/\s$/.test(value.slice(0, start));
    const needsSpaceAfter = end < value.length && !/^\s/.test(value.slice(end));
    return `${needsSpaceBefore ? ' ' : ''}${text}${needsSpaceAfter ? ' ' : ''}`;
  }

  function voiceAudioMarkup(value) {
    return [...String(value || '').matchAll(VOICE_AUDIO_MARKUP)].map((match) => match[0]).join('\n\n');
  }

  function commentTextForEditing(value) {
    return String(value || '').replace(VOICE_AUDIO_MARKUP, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  }

  function commentAudioSources(value) {
    return [...String(value || '').matchAll(VOICE_AUDIO_MARKUP)].map((match) => match[1]);
  }

  function attachmentPathFromRawUrl(url) {
    const marker = '/raw/HEAD/';
    const index = String(url || '').indexOf(marker);
    return index < 0 ? '' : String(url).slice(index + marker.length).split('/').map(decodeURIComponent).join('/');
  }

  async function loadCommentAudioPreview(url) {
    if (voiceAudioPreviewUrls[url]) return;
    const path = attachmentPathFromRawUrl(url);
    if (!path) return;
    try {
      const blob = withAudioMimeType(await downloadAttachment(token, repo, { path }), path);
      if (destroyed || voiceAudioPreviewUrls[url]) return;
      voiceAudioPreviewUrls = { ...voiceAudioPreviewUrls, [url]: URL.createObjectURL(blob) };
    } catch {
      voiceAudioPreviewErrors = { ...voiceAudioPreviewErrors, [url]: true };
    }
  }

  function withAudioMimeType(blob, name) {
    if (blob.type.startsWith('audio/')) return blob;
    const extension = String(name || '').split('.').pop()?.toLowerCase();
    const type = { webm: 'audio/webm', mp4: 'audio/mp4', m4a: 'audio/mp4', mp3: 'audio/mpeg', oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav' }[extension];
    return type ? new Blob([blob], { type }) : blob;
  }

  function updateCommentBody(comment, value) {
    const audioMarkup = voiceAudioMarkup(comment.body);
    comment.body = `${value}${audioMarkup ? `${value.trimEnd() ? '\n\n' : ''}${audioMarkup}` : ''}`;
    markCommentDirty(comment);
  }

  function replaceVoiceTarget(source, target, transcript) {
    const value = String(source || '');
    const start = Math.max(0, Math.min(target?.selectionStart ?? value.length, value.length));
    const end = Math.max(start, Math.min(target?.selectionEnd ?? start, value.length));
    return `${value.slice(0, start)}${transcript}${value.slice(end)}`;
  }

  function recordVoiceInBody() {
    if (!remoteIssue?.number) return;
    const hasCursor = document.activeElement === bodyInput;
    onVoiceRecording(remoteIssue, voiceTargetFor(bodyInput, 'body', { appendAtEnd: !hasCursor }));
  }

  function recordVoiceInComment(comment) {
    const input = document.getElementById(`comment-body-${comment.id}`);
    onVoiceRecording(remoteIssue, voiceTargetFor(input, 'comment-edit', { commentId: comment.id }));
  }

  function recordVoiceAsNewComment() {
    if (!remoteIssue?.number) return;
    onVoiceRecording(remoteIssue, { type: 'comment-new', preview: { type: 'new-comment' } });
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

  function autosize(node) {
    const scrollContainer = node.closest('.inline-editor-scroll');
    const resize = () => {
      const previousScrollTop = scrollContainer?.scrollTop || 0;
      const previousMaxScrollTop = scrollContainer
        ? Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
        : 0;
      const wasAtBottom = previousMaxScrollTop > 0
        && previousScrollTop >= previousMaxScrollTop - 1;
      const nextHeight = node.scrollHeight;
      const currentHeight = node.getBoundingClientRect().height;

      if (!nextHeight || Math.abs(currentHeight - nextHeight) < 0.5) return;
      node.style.height = `${nextHeight}px`;

      if (scrollContainer) {
        const nextMaxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
        scrollContainer.scrollTop = wasAtBottom ? nextMaxScrollTop : previousScrollTop;
      }
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
    void flushPendingWork({ reason: 'attachment-link', allowPaused: true, force: true });
  }

  async function copyAttachmentMarkdown(attachment) {
    try {
      await navigator.clipboard.writeText(composeAttachmentLink(repo, attachment));
      error = '';
    } catch {
      error = $_("m.da21b2386d");
    }
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

    cancelPreviewScrollRestore();
    pendingPreviewScrollPosition = capturePreviewScrollPosition();
    toolbarTagPicker?.close?.();
    mobileTagPicker?.close?.();
    inlineTagPickerOpen = false;
    hideMoreToolbarDropdown();
    previewMode = next;
    await tick();
    if (next) markdownViewer?.focus?.();
    else {
      restorePreviewScrollPosition();
      pendingPreviewScrollPosition = null;
      focusWithoutScrolling(editorScroll);
    }
  }

  function handlePreviewContentResize(event) {
    if (!pendingPreviewScrollPosition) return;
    cancelPreviewScrollRestore();
    if (event.detail?.pendingImages) return;

    const position = pendingPreviewScrollPosition;
    previewScrollRestoreFrame = requestAnimationFrame(() => {
      previewScrollRestoreFrame = 0;
      if (pendingPreviewScrollPosition !== position || !previewMode) return;
      restorePreviewScrollPosition(position);
      pendingPreviewScrollPosition = null;
    });
  }

  function cancelPreviewScrollRestore() {
    if (previewScrollRestoreFrame) cancelAnimationFrame(previewScrollRestoreFrame);
    previewScrollRestoreFrame = 0;
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
    if (key === 'e' || event.code === 'KeyE') return 'e';
    if (key === 'x' || event.code === 'KeyX') return 'x';
    if (event.key === 'Delete' || event.code === 'Delete') return 'delete';
    return '';
  }

  function hasNoInteractiveFocus() {
    const activeElement = document.activeElement;
    return !activeElement
      || activeElement === document.body
      || activeElement === document.documentElement
      || activeElement instanceof HTMLButtonElement
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

  // 툴바에 단축키를 표시하는 기준과 실제 실행 기준을 같은 상태에서
  // 계산한다. 첨부는 여기에 업로드 중/개수 제한이라는 추가 제약만 더한다.
  // 따라서 첨부 A가 사용 가능하면 태그 T도 반드시 사용 가능하다.
  function canUseToolbarShortcut() {
    return editable && !previewMode && lockState !== 'locked';
  }

  function canUseTagShortcut() {
    return canUseToolbarShortcut();
  }

  function canUseAttachmentShortcut() {
    return canUseToolbarShortcut()
      && Boolean(fileInput)
      && !fileInput.disabled;
  }

  function canUseNoteShortcut(key) {
    if (key === 'm') return previewMode || canPreview;
    if (key === 'l') return editable;
    if (key === 'r') return Boolean((issue || remoteIssue)?.number);
    if (key === 's') return editable && lockState !== 'locked' && !saving;
    if (key === 'e') return editable && lockState !== 'locked' && Boolean(remoteIssue?.number);
    if (key === 'x') return editable && lockState !== 'locked';
    if (key === 't') return canUseTagShortcut();
    if (key === 'a') return canUseAttachmentShortcut();
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
      void flushPendingWork({ reason: 'shortcut', allowPaused: true, force: true });
      return true;
    }
    if (key === 't') {
      return openToolbarTagPicker();
    }
    if (key === 'e') {
      recordVoiceInBody();
      return true;
    }
    if (key === 'x') {
      openReplacePanel();
      return true;
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
      void requestMove();
      return true;
    }
    return false;
  }

  async function requestMove() {
    if (!remoteIssue || readOnly) return;
    // 이슈를 닫은 뒤에 기존 자동저장이 state: 'open'을 전송하면 삭제가 즉시
    // 되돌아간다. 특히 모바일에서 입력 직후 메뉴의 삭제를 누를 때 이 경합이
    // 자주 생기므로, 먼저 저장 큐를 모두 비운 뒤 이동을 요청한다.
    clearTimeout(remoteTimer);
    const saved = await flushPendingWork({
      reason: 'move',
      allowPaused: true
    });
    if (saved) onMove(remoteIssue);
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

  function removeOneIndentationLevel(line) {
    if (line.startsWith('\t')) return line.slice(1);

    const leadingSpaces = line.match(/^ {1,4}/)?.[0].length || 0;
    return leadingSpaces ? line.slice(leadingSpaces) : line;
  }

  function mapTextareaSelectionOffset(offset, edits) {
    return edits.reduce((mappedOffset, edit) => {
      return mappedOffset + (edit.position < offset ? edit.delta : 0);
    }, offset);
  }

  function handleTextareaIndent(event) {
    const textarea = event.currentTarget;
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    if (
      (event.key !== 'Tab' && event.code !== 'Tab')
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.isComposing
    ) return false;

    const { value, selectionStart, selectionEnd } = textarea;
    if (
      selectionStart == null
      || selectionEnd == null
      || selectionStart === selectionEnd
      || !value.slice(selectionStart, selectionEnd).includes('\n')
    ) return false;

    const firstLineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    // 선택 끝이 줄의 시작이면 그 다음 빈 부분까지 포함하지 않는다. 줄바꿈
    // 자체를 선택한 경우에는 앞 줄만 처리하는 편이 편집기 동작과 자연스럽다.
    const lineSelectionEnd = selectionEnd > selectionStart && value[selectionEnd - 1] === '\n'
      ? selectionEnd - 1
      : selectionEnd;
    const lastLineStart = value.lastIndexOf('\n', lineSelectionEnd - 1) + 1;
    const lastLineEndIndex = value.indexOf('\n', lastLineStart);
    const lastLineEnd = lastLineEndIndex === -1 ? value.length : lastLineEndIndex;
    const selectedLines = value.slice(firstLineStart, lastLineEnd).split('\n');
    const edits = [];
    let lineStart = firstLineStart;

    const nextLines = selectedLines.map((line) => {
      const nextLine = event.shiftKey ? removeOneIndentationLevel(line) : `\t${line}`;
      const delta = nextLine.length - line.length;
      if (delta) edits.push({ position: lineStart, delta });
      lineStart += line.length + 1;
      return nextLine;
    });

    const nextValue = `${value.slice(0, firstLineStart)}${nextLines.join('\n')}${value.slice(lastLineEnd)}`;
    const nextSelectionStart = mapTextareaSelectionOffset(selectionStart, edits);
    const nextSelectionEnd = mapTextareaSelectionOffset(selectionEnd, edits);

    event.preventDefault();
    event.stopPropagation();
    if (nextValue === value) return true;

    textarea.value = nextValue;
    textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd, textarea.selectionDirection);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function handleEditorKeydown(event) {
    if (handleTextareaIndent(event)) return;

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

  function returnToList() {
    // 라우터의 View Transition 스냅샷보다 앞서 DOM에서도 메뉴를 제거한다.
    prepareReturnToList();
    // 목록 전환을 네트워크 요청에 묶지 않는다. 초안을 먼저 보존하고 패치는
    // 백그라운드에서 이어 간다. 저장 결과는 위 saveRemote()의 onSaved로 목록
    // 캐시에도 반영된다.
    if (hasPendingWork) {
      persistLocalDraft();
      void flushPendingWork({ reason: 'back', allowPaused: true });
    }
    onBack();
  }

  function removeTag(name) {
    if (!editable) return;
    labels = labels.filter((label) => label !== name);
    changed();
  }

</script>

<div
  class="inline-editor"
  class:is-dragging-files={draggingFiles}
  role="presentation"
  on:dragenter={handleDragEnter}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
>
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
    {#if previewMode}
      <div class="detail-toolbar-center">
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary markdown-preview-close"
          aria-label={`${$_("m.bbfa773e5a")} (M)`}
          aria-keyshortcuts="M"
          on:click={() => setMarkdownPreview(false)}
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
          {$_("m.bbfa773e5a")}
          <span class="shortcut-hint markdown-preview-shortcut">(<span class="shortcut-key" class:is-available={canUseNoteShortcut('m')}>M</span>)</span>
        </button>
      </div>
    {/if}
    {#if editable && !previewMode}
      <div class="detail-toolbar-actions detail-toolbar-actions-desktop">
        <TagPicker
          bind:this={toolbarTagPicker}
          toolbar
          shortcut="T"
          shortcutEnabled={canUseTagShortcut()}
          availableLabels={visibleAvailableLabels}
          selectedLabels={displayedLabels}
          onSelect={toggleTag}
        />
        <label
          class="btn btn-sm btn-outline-secondary detail-toolbar-attachment"
          class:disabled={uploadBatchActive || attachments.length >= MAX_ATTACHMENTS}
          for={`inline-attachment-${editorId}`}
        >
          <i class="bi bi-paperclip" aria-hidden="true"></i>
          {uploading ? $_('dynamic.uploading', { values: { count: uploading } }) : $_("m.1afff0157c")} <span class="shortcut-hint"><span class="shortcut-key" class:is-available={canUseAttachmentShortcut()}>A</span></span>
        </label>
      </div>
      <div class="detail-toolbar-actions detail-toolbar-actions-mobile">
        <TagPicker
          bind:this={mobileTagPicker}
          toolbar
          iconOnly
          shortcut="T"
          shortcutEnabled={canUseTagShortcut()}
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
          <span class="shortcut-hint" aria-hidden="true"><span class="shortcut-key" class:is-available={canUseAttachmentShortcut()}>A</span></span>
        </label>
      </div>
    {/if}
    <div class="dropdown detail-toolbar-more" bind:this={moreToolbarElement}>
      <button
        class="btn btn-outline-secondary responsive-toolbar-button"
        type="button"
        data-bs-toggle="dropdown"
        aria-expanded="false"
        aria-label={$_("m.a9b795bbb6")}
        on:mousedown|preventDefault
      ><i class="bi bi-three-dots-vertical" aria-hidden="true"></i></button>
      <div class="dropdown-menu dropdown-menu-end">
        {#if canPreview && !previewMode}
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
        {#if editable && lockState !== 'locked'}
          <button
            type="button"
            class="dropdown-item detail-toolbar-voice"
            aria-keyshortcuts="E"
            disabled={!remoteIssue?.number}
            on:click={recordVoiceInBody}
          >
            <i class="bi bi-mic-fill" aria-hidden="true"></i>
            음성 녹음 <span class="shortcut-hint"><span class="shortcut-key" class:is-available={canUseNoteShortcut('e')}>E</span></span>
          </button>
          <button
            type="button"
            class="dropdown-item detail-toolbar-replace"
            aria-keyshortcuts="X"
            on:click={openReplacePanel}
          >
            <i class="bi bi-regex" aria-hidden="true"></i>
            {$_("m.d7a8c1e4f2")} <span class="shortcut-hint"><span class="shortcut-key" class:is-available={canUseNoteShortcut('x')}>X</span></span>
          </button>
        {/if}
        {#if remoteIssue}
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
          {#if !readOnly}
            <div class="dropdown-divider"></div>
            <button
              type="button"
              class="dropdown-item"
              aria-keyshortcuts="Delete"
              on:click={() => void requestMove()}
            >
              <i class={`bi ${archived ? 'bi-arrow-counterclockwise' : 'bi-trash3'}`} aria-hidden="true"></i>
              {archived ? $_("m.3cbe6d6b9a") : $_("m.f6fdbe48dc")} <span class="shortcut-hint"><span class="shortcut-key" class:is-available={canUseNoteShortcut('delete')}>Delete</span></span>
            </button>
          {/if}
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

  {#if replacePanelOpen}
    <div class="replace-overlay">
      <div
        class="replace-panel"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby={`replace-title-${editorId}`}
        aria-describedby={`replace-help-${editorId}`}
        on:keydown={handleReplaceDialogKeydown}
      >
        <form class="replace-panel-form" on:submit|preventDefault={applyReplacement}>
          <div class="replace-panel-header">
            <h2 id={`replace-title-${editorId}`}>{$_("m.d7a8c1e4f2")}</h2>
            <button
              type="button"
              class="replace-panel-close"
              aria-label={$_("m.bbfa773e5a")}
              on:click={closeReplacePanel}
            ><i class="bi bi-x-lg" aria-hidden="true"></i></button>
          </div>
          <p id={`replace-help-${editorId}`} class="replace-panel-help">{$_("m.9e4b7c2d1f")}</p>
          <label class="replace-field" for={`replace-search-${editorId}`}>
            <span>{$_("m.1b7c9e4d6a")}</span>
            <input
              bind:this={replaceSearchInput}
              id={`replace-search-${editorId}`}
              type="text"
              bind:value={replaceSearch}
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              spellcheck="false"
            />
          </label>
          <label class="replace-field" for={`replace-with-${editorId}`}>
            <span>{$_("m.6c2f8a1b4e")}</span>
            <input
              id={`replace-with-${editorId}`}
              type="text"
              bind:value={replaceWith}
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              spellcheck="false"
            />
          </label>
          {#if replacementAnalysis.error}
            <div class="replace-panel-error" role="alert">{replacementAnalysis.error}</div>
        {:else}
          <div class="replace-match-count" role="status" aria-live="polite">
            {$_("m.3f8a2c6d1b", { values: { count: replacementAnalysis.count } })}
          </div>
        {/if}
        <div
          class="replace-example"
          class:empty={!replacementAnalysis.example}
          aria-live="polite"
          aria-hidden={!replacementAnalysis.example}
        >
          {#if replacementAnalysis.example}
            {$_("m.a4c7e9d2b6", { values: replacementAnalysis.example })}
          {/if}
        </div>
        <div class="replace-panel-actions">
            <button type="button" class="btn btn-outline-secondary" tabindex="-1" on:click={closeReplacePanel}>{$_("setup.cancel")}</button>
            <button
              type="submit"
              class="btn btn-primary"
              disabled={!replaceSearch || replacementAnalysis.error || !replacementAnalysis.count}
            >{$_("m.d7a8c1e4f2")}</button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <div
    class="inline-editor-scroll note-content"
    class:markdown-preview-mode={previewMode}
    bind:this={editorScroll}
    tabindex="-1"
    use:focusBodyFromOuterGutter
  >
  <div
    class="inline-editor-fields"
    class:is-lock-protected={lockState !== 'plain'}
    role="presentation"
    style={`--note-font:${fontStack};--note-font-size:${fontSize}px;--note-line-height:${lineHeight};--editor-max-width:${maxWidth}px`}
  >
    {#if attachments.length || uploading || deletingPath || (attachmentsLoading && hasAttachmentRefs)}
      <section
        class="attachment-section"
      >
        {#if !attachments.length && attachmentsLoading && !uploading && !deletingPath}
          <div class="attachment-list-loading">
            <span class="attachment-spinner"><BrailleSpinner active /></span>
          </div>
        {:else}
        <div class="attachment-list">
          {#each attachments as attachment, index (attachment.path)}
            <div
              class="attachment-item"
              class:is-loading={deletingPath === attachment.path}
              class:is-pending-delete={pendingAttachmentDeletes.has(attachment.path)}
            >
              <button
                type="button"
                class="attachment-open"
                disabled={Boolean(deletingPath) || pendingAttachmentDeletes.has(attachment.path)}
                on:click={() => openViewer(index)}
              >
                {#if deletingPath === attachment.path}
                  <span class="attachment-loading"><span class="attachment-spinner"><BrailleSpinner active /></span></span>
                {:else if isImage(attachment)}
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
              {#if pendingAttachmentDeletes.has(attachment.path)}
                <div class="attachment-pending-delete" role="status">
                  <span class="attachment-spinner"><BrailleSpinner active /></span>
                  <span>{$_('dynamic.attachmentDeleting')}</span>
                  {#if deletingPath !== attachment.path && editable && !previewMode}
                    <button
                      type="button"
                      class="attachment-cancel-delete"
                      on:click|stopPropagation={() => cancelAttachmentDeletion(attachment)}
                    >{$_('setup.cancel')}</button>
                  {/if}
                </div>
              {:else if editable && !previewMode}
                <button
                  type="button"
                  class="attachment-delete"
                  disabled={Boolean(deletingPath)}
                  on:click={() => removeAttachment(attachment)}
                  aria-label={$_('dynamic.deleteAttachment', { values: { name: attachment.name } })}
                >
                  <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
              {/if}
            </div>
          {/each}
          {#each uploadingAttachments as attachment (attachment.id)}
            <div
              class="attachment-item attachment-uploading"
              role="status"
              aria-label={$_('dynamic.uploading', { values: { count: 1 } })}
            >
              <span class="attachment-loading"><span class="attachment-spinner"><BrailleSpinner active /></span></span>
              <span class="attachment-name" title={attachment.name}>{attachment.name}</span>
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
      </section>
    {/if}
    {#if displayedLabels.length || inlineTagPickerOpen}
      <div class="editor-tags">
        {#each displayedLabels as label (label)}
          <span class="editor-tag" style={`--tag-color:${tagColor(label)}`}>
            <button
              type="button"
              class="editor-tag-link"
              on:click={() => onTagSelect(label)}
            >#{label}</button>
            {#if editable && !previewMode}
              <button
                type="button"
                class="editor-tag-remove"
                on:click|stopPropagation={() => removeTag(label)}
                aria-label={$_('dynamic.removeTag', { values: { name: label } })}
              ><i class="bi bi-x" aria-hidden="true"></i></button>
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
        imageSources={previewImageSources}
        emptyLabel={$_("m.0c3fd88e60")}
        on:contentresize={handlePreviewContentResize}
      />
    {:else}
      <textarea
        bind:this={bodyInput}
        class="inline-body"
        value={displayBody}
        on:compositionstart={handleBodyCompositionStart}
        on:compositionend={handleBodyCompositionEnd}
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
                        on:mousedown|preventDefault
                      ><i class="bi bi-three-dots" aria-hidden="true"></i></button>
                      <ul class="dropdown-menu dropdown-menu-end">
                        <li>
                          <button
                            type="button"
                            class="dropdown-item"
                            on:click={() => recordVoiceInComment(comment)}
                          ><i class="bi bi-mic-fill" aria-hidden="true"></i> 음성 녹음</button>
                        </li>
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
                  value={commentTextForEditing(comment.body)}
                  on:input={(event) => updateCommentBody(comment, event.currentTarget.value)}
                  on:keydown={handleEditorKeydown}
                  on:blur={() => saveComment(comment)}
                  placeholder={$_("m.ee6540eb88")}
                  maxlength={MAX_ISSUE_COMMENT_LENGTH}
                  readonly={!editable || lockState === 'locked'}
                  use:autosize={comment.body}
                ></textarea>
                {#each commentAudioSources(comment.body) as source}
                  {#if voiceAudioPreviewUrls[source]}
                    <audio class="note-comment-audio" controls preload="metadata" src={voiceAudioPreviewUrls[source]}>
                      이 브라우저에서는 음성 미리보기를 지원하지 않습니다.
                    </audio>
                  {:else if voiceAudioPreviewErrors[source]}
                    <span class="note-comment-audio-error">원본 음성을 불러오지 못했습니다.</span>
                  {:else}
                    <span class="note-comment-audio-loading"><BrailleSpinner active /></span>
                  {/if}
                {/each}
              {/if}
            </div>
          {/each}
        {/if}
        {#if editable && lockState !== 'locked' && remoteIssue?.number && !previewMode}
          <div class="note-comment-add-actions">
            <button type="button" class="note-comment-add" on:click={addComment}>
              <i class="bi bi-plus-lg" aria-hidden="true"></i> {$_("m.7d3764e42e")}
            </button>
            <button type="button" class="note-comment-add" on:click={recordVoiceAsNewComment}>
              <i class="bi bi-mic-fill" aria-hidden="true"></i> 음성 추가
            </button>
          </div>
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
        {#if editable}
          <button type="button" on:click={() => copyAttachmentMarkdown(viewedAttachment)}>
            <i class="bi bi-copy" aria-hidden="true"></i> Markdown 복사
          </button>
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
            <BrailleSpinner active />
          {/if}
        {:else if isAudio(viewedAttachment)}
          {#if previewUrls[viewedAttachment.path]}
            <div class="attachment-audio-view">
              <audio controls preload="metadata" src={previewUrls[viewedAttachment.path]}>
                이 브라우저에서는 음성 미리보기를 지원하지 않습니다.
              </audio>
            </div>
          {:else}
            <BrailleSpinner active />
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
        {#if attachments.length > 1}
          <button type="button" class="viewer-nav viewer-prev" on:click={() => moveViewer(-1)} aria-label={$_("m.ad0c7c8ea7")}>
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
          </button>
          <button type="button" class="viewer-nav viewer-next" on:click={() => moveViewer(1)} aria-label={$_("m.57bc468d7d")}>
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>
