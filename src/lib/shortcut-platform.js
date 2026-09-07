export function shortcutModifierForPlatform({ platform = '', userAgent = '' } = {}) {
  const isAppleDevice = /Mac|iPhone|iPad|iPod/.test(platform);
  const isSafari = /Safari\//.test(userAgent) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR/.test(userAgent);
  // Safari는 Cmd+숫자를 브라우저 탭 전환으로 선점한다.
  return isAppleDevice && !isSafari ? '⌘' : '⌃';
}
