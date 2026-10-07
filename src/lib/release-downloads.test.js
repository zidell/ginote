import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_DOWNLOADS, formatSize, loadTuiDownloads, pickTuiDownloads } from './release-downloads.js';

const asset = (name, size = 1) => ({ name, size, browser_download_url: `https://github.com/zidell/ginote/releases/download/x/${name}` });

const desktopRelease = {
  tag_name: 'v0.1.91',
  assets: [
    'Ginote-0.1.91-1.x86_64.rpm', 'Ginote-0.1.91-1.x86_64.rpm.sig', 'Ginote_0.1.91_amd64.AppImage', 'Ginote_0.1.91_amd64.AppImage.sig',
    'Ginote_0.1.91_amd64.deb', 'Ginote_0.1.91_universal.app.tar.gz', 'Ginote_0.1.91_universal.dmg', 'Ginote_0.1.91_x64-setup.exe',
    'Ginote_0.1.91_x64-setup.exe.sig', 'latest.json'
  ].map((name) => asset(name))
};

describe('release-downloads', () => {
  it('데스크톱 설치 파일은 최신 릴리스의 고정 이름으로 연결한다', () => {
    expect(DESKTOP_DOWNLOADS.dmg).toEqual({ name: 'Ginote_universal.dmg', url: 'https://github.com/zidell/ginote/releases/latest/download/Ginote_universal.dmg' });
    expect(Object.values(DESKTOP_DOWNLOADS).map((file) => file.name)).toEqual([
      'Ginote_universal.dmg', 'Ginote_x64-setup.exe', 'Ginote_amd64.AppImage', 'Ginote_amd64.deb', 'Ginote.x86_64.rpm'
    ]);
  });

  it('가장 최근 tui-v 릴리스의 실행 파일을 고른다', () => {
    const releases = [
      { tag_name: 'tui-v0.2.0', draft: true, assets: [asset('ginote-tui_linux-amd64.tar.gz')] },
      { tag_name: 'tui-v0.1.9', published_at: '2026-10-07T01:13:07Z', assets: [asset('ginote-tui_linux-arm64.tar.gz')] },
      { tag_name: 'v0.1.91', published_at: '2026-10-08T00:00:00Z', assets: desktopRelease.assets },
      { tag_name: 'tui-v0.1.10', published_at: '2026-10-07T01:16:59Z', assets: ['ginote-tui_darwin-amd64.tar.gz', 'ginote-tui_darwin-arm64.tar.gz', 'ginote-tui_linux-amd64.tar.gz', 'ginote-tui_windows-amd64.zip', 'ginote-tui_windows-amd64.zip.sha256'].map((name) => asset(name)) }
    ];
    expect(pickTuiDownloads(releases).map((file) => `${file.label}=${file.name}`)).toEqual([
      'macOS (Apple Silicon)=ginote-tui_darwin-arm64.tar.gz',
      'macOS (Intel)=ginote-tui_darwin-amd64.tar.gz',
      'Linux x86_64=ginote-tui_linux-amd64.tar.gz',
      'Windows x64=ginote-tui_windows-amd64.zip'
    ]);
    expect(pickTuiDownloads(null)).toEqual([]);
  });

  it('TUI 릴리스 목록을 API에서 받아 고르고, 실패하면 오류를 넘긴다', async () => {
    const release = { tag_name: 'tui-v0.1.10', published_at: '2026-10-07T01:16:59Z', assets: [asset('ginote-tui_linux-amd64.tar.gz')] };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => [release] }));
    expect((await loadTuiDownloads(fetchImpl)).map((file) => file.name)).toEqual(['ginote-tui_linux-amd64.tar.gz']);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.github.com/repos/zidell/ginote/releases?per_page=10', expect.anything());
    await expect(loadTuiDownloads(async () => ({ ok: false, status: 403 }))).rejects.toThrow('403');
  });

  it('파일 크기를 읽기 쉽게 적는다', () => {
    expect(formatSize(12_345_678)).toBe('11.8 MB');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(0)).toBe('');
  });
});
