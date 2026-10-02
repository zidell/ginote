import { get, writable } from 'svelte/store';
import { loadVoiceTranscriptionHints, saveVoiceTranscriptionHints } from './github.js';
import {
  clearPendingVoiceTranscriptionHints,
  loadPendingVoiceTranscriptionHints,
  savePendingVoiceTranscriptionHints
} from './voice-settings.js';

const INITIAL_STATE = { value: '', loadedRepo: '', loading: false, saving: false, error: '' };

// 저장소별 "자주 쓰는 전사 단어"다. 저장소에 보관해 다른 기기와 공유하고,
// 환경설정에서 고친 값은 GitHub에 저장할 때까지 이 기기에 임시로 둔다.
// getContext()는 현재 워크스페이스의 { token, repo }를 돌려준다. 요청 중에
// 워크스페이스가 바뀌면 그 응답은 버린다.
export function createTranscriptionHints(getContext) {
  const state = writable({ ...INITIAL_STATE });
  let loadPromise = null;

  function patch(fields) {
    state.update((current) => ({ ...current, ...fields }));
  }

  function isCurrent(token, repo) {
    const context = getContext();
    return context.token === token && context.repo === repo;
  }

  return {
    subscribe: state.subscribe,

    // 워크스페이스를 바꾸면 이전 저장소의 값과 진행 표시를 모두 비운다.
    reset() {
      loadPromise = null;
      state.set({ ...INITIAL_STATE });
    },

    load(force = false) {
      const { token, repo } = getContext();
      if (!token || !repo) return undefined;
      if (!force && get(state).loadedRepo === repo) return undefined;
      if (loadPromise) return loadPromise;

      // 아직 GitHub에 저장하지 못한 이 기기의 수정분이 있으면 그 값을 믿는다.
      const pending = loadPendingVoiceTranscriptionHints(repo);
      if (pending !== null) {
        patch({ value: pending, loadedRepo: repo });
        return undefined;
      }

      patch({ loading: true, error: '' });
      const task = loadVoiceTranscriptionHints(token, repo)
        .then((hints) => {
          if (isCurrent(token, repo)) patch({ value: hints, loadedRepo: repo });
        })
        .catch((reason) => {
          if (isCurrent(token, repo)) patch({ error: reason?.message || '전사 힌트를 불러오지 못했습니다.' });
        })
        .finally(() => {
          if (isCurrent(token, repo)) patch({ loading: false });
          if (loadPromise === task) loadPromise = null;
        });
      loadPromise = task;
      return task;
    },

    stage(value) {
      patch({ value });
      savePendingVoiceTranscriptionHints(getContext().repo, value);
    },

    async flush() {
      const { token, repo } = getContext();
      if (!token || !repo || get(state).saving) return;
      const value = loadPendingVoiceTranscriptionHints(repo);
      if (value === null) return;
      patch({ saving: true, error: '' });
      try {
        await saveVoiceTranscriptionHints(token, repo, value);
        if (isCurrent(token, repo)) {
          clearPendingVoiceTranscriptionHints(repo);
          patch({ loadedRepo: repo });
        }
      } catch (reason) {
        if (isCurrent(token, repo)) patch({ error: reason?.message || '전사 힌트를 저장하지 못했습니다.' });
      } finally {
        if (isCurrent(token, repo)) patch({ saving: false });
      }
    }
  };
}
