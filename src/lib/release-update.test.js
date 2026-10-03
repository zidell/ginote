import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSnapshot } from './app-config.js';
import { installedSnapshot, useInstalledSnapshot } from './installed-settings.js';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  findReleaseUpdate,
  installReleaseUpdate,
  releaseUpdateSupported,
  saveReleaseUpdatePreferences,
  watchReleaseUpdates
} from './release-update.js';

const update = (version) => ({ version, currentVersion: '0.1.1', downloadAndInstall: vi.fn() });

beforeEach(() => {
  useInstalledSnapshot(defaultSnapshot(), () => {});
});

afterEach(() => {
  useInstalledSnapshot(null, null);
  vi.useRealTimers();
});

describe('app release updates', () => {
  it('is only supported where the native shell says so', async () => {
    expect(await releaseUpdateSupported({ isTauri: false })).toBe(false);
    expect(await releaseUpdateSupported({ isTauri: true, invoke: async () => true })).toBe(true);
    expect(await releaseUpdateSupported({ isTauri: true, invoke: async () => { throw new Error('old shell'); } })).toBe(false);
  });

  it('does not offer a skipped version again unless the user checks manually', async () => {
    saveReleaseUpdatePreferences({ skippedVersion: '0.1.5' });
    expect(installedSnapshot().updates.skippedVersion).toBe('0.1.5');

    expect(await findReleaseUpdate({ check: async () => update('0.1.5') })).toBeNull();
    expect((await findReleaseUpdate({ manual: true, check: async () => update('0.1.5') })).version).toBe('0.1.5');
    expect((await findReleaseUpdate({ check: async () => update('0.1.6') })).version).toBe('0.1.6');
    expect(await findReleaseUpdate({ check: async () => null })).toBeNull();
  });

  it('checks shortly after launch and then periodically while automatic checks are on', async () => {
    vi.useFakeTimers();
    const find = vi.fn(async () => update('0.1.6'));
    const onUpdate = vi.fn();
    const stop = watchReleaseUpdates(onUpdate, { supported: async () => true, find });

    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(find).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    saveReleaseUpdatePreferences({ checkAutomatically: false });
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(find).toHaveBeenCalledTimes(1);

    saveReleaseUpdatePreferences({ checkAutomatically: true });
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(find).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('never checks on platforms whose store handles updates', async () => {
    vi.useFakeTimers();
    const find = vi.fn();
    watchReleaseUpdates(vi.fn(), { supported: async () => false, find });
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS);
    expect(find).not.toHaveBeenCalled();
  });

  it('reports download progress as a fraction', async () => {
    const target = update('0.1.6');
    target.downloadAndInstall.mockImplementation(async (onEvent) => {
      onEvent({ event: 'Started', data: { contentLength: 200 } });
      onEvent({ event: 'Progress', data: { chunkLength: 50 } });
      onEvent({ event: 'Progress', data: { chunkLength: 150 } });
      onEvent({ event: 'Finished' });
    });
    const progress = [];
    await installReleaseUpdate(target, (value) => progress.push(value));
    expect(progress).toEqual([0, 0.25, 1, 1]);
  });
});
