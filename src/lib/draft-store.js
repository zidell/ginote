import { replaceLabelName } from './issue-labels.js';

// 저장 전 노트 초안이다. { [repo]: { [draftId]: { title, body, labels, savedAt } } }
export const DRAFTS_STORAGE_KEY = 'issue-note.drafts.v1';

export function readDraftStore() {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function writeDraftStore(store) {
  localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(store));
}

// 저장소 태그 이름이 바뀌거나 지워지면 그 저장소 초안의 태그도 맞춘다.
export function renameDraftLabels(repo, currentName, nextName = '') {
  try {
    const store = JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY) || '{}');
    const repoDrafts = store[repo];
    if (!repoDrafts) return;
    for (const draft of Object.values(repoDrafts)) {
      if (!Array.isArray(draft.labels)) continue;
      draft.labels = replaceLabelName(draft.labels, currentName, nextName);
    }
    writeDraftStore(store);
  } catch {
    // 손상된 초안 저장소는 편집기가 자체적으로 무시한다.
  }
}
