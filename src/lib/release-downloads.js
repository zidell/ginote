// Installer links for the landing page. GitHub serves release assets as attachments,
// so the browser downloads the file and the landing page stays open.
const API = 'https://api.github.com/repos/zidell/ginote/releases';
export const LATEST_RELEASE_URL = 'https://github.com/zidell/ginote/releases/latest';

// release.yml also uploads each desktop installer under a name without the version, so
// releases/latest/download/<name> always points at the newest installer without asking the API.
const desktopFile = (name) => ({ name, url: `${LATEST_RELEASE_URL}/download/${name}` });
export const DESKTOP_DOWNLOADS = {
  dmg: desktopFile('Ginote_universal.dmg'),
  windows: desktopFile('Ginote_x64-setup.exe'),
  appImage: desktopFile('Ginote_amd64.AppImage'),
  deb: desktopFile('Ginote_amd64.deb'),
  rpm: desktopFile('Ginote.x86_64.rpm')
};

const TUI_ASSETS = [
  { key: 'darwin-arm64', label: 'macOS (Apple Silicon)' },
  { key: 'darwin-amd64', label: 'macOS (Intel)' },
  { key: 'linux-amd64', label: 'Linux x86_64' },
  { key: 'linux-arm64', label: 'Linux arm64' },
  { key: 'windows-amd64', label: 'Windows x64' }
];

export function pickTuiDownloads(releases) {
  // The API list is not strictly newest first (tui-v0.1.9 came before tui-v0.1.10), so compare publish times.
  const release = (releases || [])
    .filter((item) => !item.draft && item.tag_name?.startsWith('tui-v'))
    .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')))[0];
  if (!release) return [];
  return TUI_ASSETS.flatMap(({ key, label }) => {
    const asset = release.assets?.find((item) => item.name === `ginote-tui_${key}.tar.gz` || item.name === `ginote-tui_${key}.zip`);
    return asset ? [{ label, name: asset.name, url: asset.browser_download_url, size: asset.size }] : [];
  });
}

export function formatSize(bytes) {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub releases ${response.status}`);
  return response.json();
}

// TUI releases are prereleases, so releases/latest never points at them; find the newest one through the API.
// A failed request leaves the list empty and the page links to the release list instead.
export async function loadTuiDownloads(fetchImpl = globalThis.fetch) {
  return pickTuiDownloads(await getJson(`${API}?per_page=10`, fetchImpl));
}
