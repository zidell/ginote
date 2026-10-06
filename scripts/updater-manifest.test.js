import { describe, expect, it } from 'vitest';
import { buildUpdaterManifest } from './updater-manifest.mjs';

const base = 'https://github.com/zidell/ginote/releases/download/v0.1.9';

describe('updater manifest', () => {
  it('maps each signed update file to the keys the updater looks up', () => {
    const manifest = buildUpdaterManifest({
      version: '0.1.9',
      baseUrl: base,
      pubDate: '2026-10-03T00:00:00Z',
      signatures: {
        'Ginote_universal.app.tar.gz': 'mac-sig\n',
        'Ginote_0.1.9_amd64.AppImage': 'appimage-sig',
        'Ginote_0.1.9_amd64.deb': 'deb-sig',
        'Ginote-0.1.9-1.x86_64.rpm': 'rpm-sig',
        'Ginote_0.1.9_x64-setup.exe': 'windows-sig',
        'Ginote_0.1.9_universal.dmg': 'ignored'
      }
    });

    expect(manifest.version).toBe('0.1.9');
    expect(manifest.platforms['darwin-aarch64']).toEqual({ signature: 'mac-sig', url: `${base}/Ginote_universal.app.tar.gz` });
    expect(manifest.platforms['darwin-x86_64'].url).toBe(`${base}/Ginote_universal.app.tar.gz`);
    expect(manifest.platforms['linux-x86_64'].signature).toBe('appimage-sig');
    expect(manifest.platforms['linux-x86_64-deb'].url).toBe(`${base}/Ginote_0.1.9_amd64.deb`);
    expect(manifest.platforms['linux-x86_64-rpm'].signature).toBe('rpm-sig');
    expect(manifest.platforms['windows-x86_64-nsis'].signature).toBe('windows-sig');
    expect(Object.keys(manifest.platforms)).toHaveLength(10);
  });

  it('refuses to publish a manifest that misses a platform', () => {
    expect(() => buildUpdaterManifest({ version: '1', baseUrl: base, signatures: { 'Ginote_universal.app.tar.gz': 's' } }))
      .toThrow('linux-x86_64');
  });
});
