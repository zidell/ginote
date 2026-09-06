const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;

export function parseRepositoryAddress(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  if (!REPO_PATTERN.test(cleaned)) return null;
  const [owner, name] = cleaned.split('/');
  return { owner, name, fullName: cleaned };
}

export function normalizeToken(value) {
  return String(value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
}

export function makePatCreationUrl(value) {
  const selected = parseRepositoryAddress(value);
  const url = new URL('https://github.com/settings/personal-access-tokens/new');
  url.searchParams.set('name', `Ginote${selected ? ` - ${selected.name}` : ''}`.slice(0, 40));
  url.searchParams.set(
    'description',
    selected ? `Ginote access for ${selected.fullName}` : 'Ginote repository access'
  );
  url.searchParams.set('expires_in', 'none');
  url.searchParams.set('issues', 'write');
  url.searchParams.set('contents', 'write');
  if (selected) url.searchParams.set('target_name', selected.owner);
  return url.toString();
}
