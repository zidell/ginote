import { writable } from 'svelte/store';
import { isStandaloneWebApp } from './external-links.js';

const BANNER_DISMISSED_KEY = 'ginote:pwa-install-banner-dismissed';

// Chrome fires beforeinstallprompt once, often before the first component mounts,
// so the event is kept here from module load until someone asks to install.
export const installPrompt = writable(null);
export const appInstalled = writable(false);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt.set(event);
  });
  window.addEventListener('appinstalled', () => {
    installPrompt.set(null);
    appInstalled.set(true);
  });
}

export function mobilePlatform(nav = typeof navigator === 'undefined' ? null : navigator) {
  const userAgent = nav?.userAgent || '';
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  // iPadOS Safari reports a Mac user agent; only the touch screen tells them apart.
  if (/Macintosh/i.test(userAgent) && nav?.maxTouchPoints > 1) return 'ios';
  return '';
}

// Desktop browsers already show their own install button, and an installed app has nothing to install.
export function mobileInstallPlatform({ installedApp = false } = {}) {
  if (installedApp || isStandaloneWebApp()) return '';
  return mobilePlatform();
}

export async function promptInstall(event) {
  if (!event) return false;
  installPrompt.set(null);
  await event.prompt();
  const choice = await event.userChoice;
  return choice?.outcome === 'accepted';
}

export function isInstallBannerDismissed() {
  try {
    return localStorage.getItem(BANNER_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallBanner() {
  try {
    localStorage.setItem(BANNER_DISMISSED_KEY, '1');
  } catch {}
}
