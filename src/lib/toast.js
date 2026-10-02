import { writable } from 'svelte/store';

// 잠깐 떴다 사라지는 한 줄 알림이다. 새 알림은 이전 알림을 바로 대신한다.
export function createToast(durationMs = 2400) {
  const message = writable('');
  let timer;

  return {
    subscribe: message.subscribe,
    show(text) {
      clearTimeout(timer);
      message.set(text);
      timer = setTimeout(() => message.set(''), durationMs);
    },
    destroy() {
      clearTimeout(timer);
    }
  };
}
