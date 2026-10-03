import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSnapshot } from './app-config.js';
import { setAppLocale } from './i18n.js';
import { installedSnapshot, useInstalledSnapshot } from './installed-settings.js';

const restart = vi.hoisted(() => vi.fn());
vi.mock('./release-update.js', async (importOriginal) => ({ ...(await importOriginal()), restartApp: restart }));

import ReleaseUpdateDialog from './ReleaseUpdateDialog.svelte';

function offer(downloadAndInstall = vi.fn(async () => {})) {
  const onClose = vi.fn();
  const update = { version: '0.1.6', currentVersion: '0.1.5', body: 'Faster sync', downloadAndInstall };
  render(ReleaseUpdateDialog, { update, onClose });
  return { onClose, update };
}

beforeEach(() => {
  setAppLocale('en');
  useInstalledSnapshot(defaultSnapshot(), () => {});
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  cleanup();
  useInstalledSnapshot(null, null);
  vi.unstubAllGlobals();
  restart.mockReset();
});

describe('ReleaseUpdateDialog', () => {
  it('offers install, later and skip with the release notes', () => {
    offer();
    expect(screen.getByText('Ginote 0.1.6 is available. You have 0.1.5.')).toBeTruthy();
    expect(screen.getByText('Faster sync')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip this version' })).toBeTruthy();
  });

  it('remembers a skipped version', async () => {
    const { onClose } = offer();
    await fireEvent.click(screen.getByRole('button', { name: 'Skip this version' }));
    expect(installedSnapshot().updates.skippedVersion).toBe('0.1.6');
    expect(onClose).toHaveBeenCalled();
  });

  it('installs, then asks before restarting', async () => {
    const { update } = offer();
    await fireEvent.click(screen.getByRole('button', { name: 'Install now' }));
    expect(update.downloadAndInstall).toHaveBeenCalled();
    await fireEvent.click(await screen.findByRole('button', { name: 'Restart now' }));
    expect(restart).toHaveBeenCalled();
  });

  it('shows the error and lets the user try again when installing fails', async () => {
    offer(vi.fn(async () => { throw new Error('signature mismatch'); }));
    await fireEvent.click(screen.getByRole('button', { name: 'Install now' }));
    expect(await screen.findByText(/Could not install the update\. signature mismatch/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install now' })).toBeTruthy();
  });
});
