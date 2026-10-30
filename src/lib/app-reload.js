let pendingReload = null;

// 열려 있거나 화면 종료 후 저장 중인 편집기가 모두 저장을 마친 뒤 새로고침한다.
export function reloadApp({ target = window, reload = () => window.location.reload() } = {}) {
  if (pendingReload) return pendingReload;
  const saves = [];
  target.dispatchEvent(new CustomEvent('app-before-reload', { detail: { saves } }));
  pendingReload = (async () => {
    try {
      const results = await Promise.all(saves);
      if (results.some((saved) => saved === false)) return false;
      reload();
      return true;
    } catch {
      return false;
    } finally {
      pendingReload = null;
    }
  })();
  return pendingReload;
}
