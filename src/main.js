import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import 'bootstrap/js/dist/dropdown';
import './app.css';
import { openUrl } from '@tauri-apps/plugin-opener';
import { mount } from 'svelte';
import App from './App.svelte';
import { prepareAppUpdate } from './lib/app-update.js';
import { normalizeLocale, translate } from './lib/i18n.js';
import { initInstalledSettings, lastKnownInstalledTheme } from './lib/settings-backend.js';
import { applyTheme, loadSettingsDocument } from './lib/settings-storage.js';

// 첫 페인트 전에 저장된 테마를 적용해 다크모드 화면이 잠깐 번쩍이는 현상을 막는다.
// 설치형 앱은 설정을 config.toml에 두므로, 파일을 읽기 전에는 마지막으로 쓴 테마를 쓴다.
applyTheme(window.__TAURI_INTERNALS__ ? lastKnownInstalledTheme() : loadSettingsDocument()?.preferences?.theme);

document.documentElement.lang = normalizeLocale(navigator.language);
document.querySelector('meta[name="description"]')?.setAttribute(
  'content',
  translate('meta.description')
);

document.addEventListener('click', (event) => {
  if (!window.__TAURI_INTERNALS__) return;
  const anchor = event.target.closest('a[href]');
  if (!anchor) return;
  const url = new URL(anchor.href, window.location.href);
  if (!['http:', 'https:'].includes(url.protocol)) return;
  event.preventDefault();
  openUrl(url.href).catch(() => {});
});

const appTarget = document.getElementById('app');
// 자바스크립트 없이도 사용법이 보이도록 index.html에 넣어 둔 안내다. 앱을 붙이기 전에 비운다.
appTarget.textContent = '';

// 앱에서 한 달 넘게 업데이트를 받지 못했으면 새 빌드를 먼저 적용한 뒤 띄운다(docs/APP_OTA.md).
// 설치형 앱의 설정 파일(docs/CONFIG.md)도 화면을 띄우기 전에 읽어 둔다.
Promise.all([
  prepareAppUpdate({
    onWaiting: () => {
      appTarget.textContent = translate('dynamic.appUpdating');
    }
  }),
  initInstalledSettings()
]).then(([applied]) => {
  if (applied) {
    window.location.reload();
    return;
  }
  appTarget.textContent = '';
  applyTheme(loadSettingsDocument()?.preferences?.theme);
  mount(App, {
    target: appTarget
  });
});

if ('serviceWorker' in navigator && import.meta.env.PROD && !window.__TAURI_INTERNALS__) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('./sw.js', document.baseURI));
  });
}
