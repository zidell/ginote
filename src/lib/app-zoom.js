import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isInstalledApp } from './dialogs.js';
import { mobilePlatform } from './pwa-install.js';

export function normalizeAppScale(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(2, Math.max(0.5, value)) * 100) / 100
    : 1;
}

export function appZoomAction(event) {
  if (Boolean(event.ctrlKey) === Boolean(event.metaKey) || event.altKey || event.isComposing) return null;
  if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'in';
  if (!event.shiftKey && (event.key === '-' || event.code === 'NumpadSubtract')) return 'out';
  if (!event.shiftKey && (event.key === '0' || event.code === 'Numpad0')) return 'reset';
  return null;
}

// WebView 배율로 미디어 쿼리·고정 배치·스크롤 영역까지 함께 확대한다.
// 브라우저와 모바일은 자체 확대 기능을 그대로 사용한다.
export function createAppZoom({
  target = window,
  enabled = isInstalledApp() && !mobilePlatform(),
  getScale,
  onChange,
  onError = () => {},
  setZoom = (scale) => getCurrentWebview().setZoom(scale)
}) {
  let queue = Promise.resolve();
  let appliedScale;
  let stopped = false;
  function enqueue(task) {
    queue = queue.then(async () => {
      if (!enabled || stopped) return;
      await task();
    }).catch(onError);
    return queue;
  }
  async function apply(scale) {
    if (scale === appliedScale) return;
    await setZoom(scale);
    appliedScale = scale;
  }
  function handleKeydown(event) {
    const action = appZoomAction(event);
    if (!enabled || action === null) return;
    event.preventDefault();
    event.stopPropagation();
    void enqueue(async () => {
      const scale = normalizeAppScale(action === 'reset' ? 1 : getScale() + (action === 'in' ? 0.1 : -0.1));
      await apply(scale);
      if (!stopped && scale !== getScale()) onChange(scale);
    });
  }
  // 편집기나 하위 화면에서 키를 소비하기 전에 처리한다.
  target.addEventListener('keydown', handleKeydown, true);
  return {
    sync: (scale) => enqueue(() => apply(normalizeAppScale(scale))),
    destroy() {
      stopped = true;
      target.removeEventListener('keydown', handleKeydown, true);
    }
  };
}
