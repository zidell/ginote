// 미리보기 GIF 전용 더미 데이터와 GitHub API 모의 응답.
// 실제 저장소를 건드리지 않고도 목록·검색·작성·태그·휴지통 흐름을 모두 보여준다.
import { tagColorForName } from '../../src/lib/colors.js';

export const PREVIEW_REPO = 'octocat/notes';
export const PREVIEW_TOKEN = 'github_pat_preview_dummy_token';

const AVATAR = 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
     <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0" stop-color="#4f7cf7"/><stop offset="1" stop-color="#8b5cf6"/>
     </linearGradient></defs>
     <rect width="96" height="96" rx="48" fill="url(#g)"/>
     <text x="48" y="62" font-family="Helvetica, Arial, sans-serif" font-size="42"
       font-weight="700" fill="#ffffff" text-anchor="middle">O</text>
   </svg>`
).toString('base64');

const LABEL_NAMES = ['work', 'reading', 'travel', 'home', 'ideas'];

const label = (name) => ({
  id: 100 + LABEL_NAMES.indexOf(name),
  name,
  color: tagColorForName(name),
  description: ''
});

const issue = ({ number, body, labels = [], updatedAt, state = 'open', closedAt = null, comments = 0 }) => ({
  id: 1000 + number,
  number,
  state,
  title: (body.split('\n', 1)[0] || '').trim().slice(0, 50),
  body,
  labels: labels.map(label),
  comments,
  user: { login: 'octocat', avatar_url: AVATAR },
  html_url: `https://github.com/${PREVIEW_REPO}/issues/${number}`,
  created_at: updatedAt,
  updated_at: updatedAt,
  closed_at: closedAt
});

// 목록 미리보기는 본문 첫 줄을 제목으로 쓰기 때문에 첫 줄을 또렷하게 적는다.
const SEED_ISSUES = [
  issue({
    number: 142,
    updatedAt: '2026-09-04T09:12:00Z',
    labels: ['work'],
    body: `Platform sync — weekly notes

- Search indexing rollout moves to the 12th
- Attachment cleanup job now runs nightly
- Ask design for the empty-state copy

Next: draft the release note before Friday.`
  }),
  issue({
    number: 139,
    updatedAt: '2026-09-03T21:40:00Z',
    labels: ['travel'],
    body: `Kyoto trip — November plan

Fushimi Inari before sunrise, Arashiyama on the second morning.
Book the ryokan in Gion while the autumn rates are still open.

Packing: light jacket, spare SD card, the small tripod.`
  }),
  issue({
    number: 136,
    updatedAt: '2026-09-03T08:05:00Z',
    labels: ['reading'],
    body: `Reading list — distributed systems

1. Designing Data-Intensive Applications, ch. 5-7
2. The Log, Jay Kreps
3. Notes on CRDTs for the offline editor idea`
  }),
  issue({
    number: 131,
    updatedAt: '2026-09-02T18:22:00Z',
    labels: ['ideas'],
    body: `Side project ideas

A tiny reader that keeps highlights as issues.
Offline-first notes that sync through a repository.
Weekly digest mailed from a scheduled workflow.`
  }),
  issue({
    number: 128,
    updatedAt: '2026-09-01T12:30:00Z',
    labels: ['home'],
    body: `Grocery run

Coffee beans, oat milk, tomatoes, bread flour.
Pick up the package at the locker before 9pm.`
  }),
  issue({
    number: 124,
    updatedAt: '2026-08-31T10:15:00Z',
    labels: ['work', 'ideas'],
    body: `Onboarding rewrite — outline

Start from the repository, not from the token.
Show a real note within the first minute.`
  }),
  issue({
    number: 119,
    updatedAt: '2026-08-28T15:48:00Z',
    labels: ['home'],
    state: 'closed',
    closedAt: '2026-08-29T02:10:00Z',
    body: `Old shopping list

Cleared after the weekend.`
  }),
  issue({
    number: 112,
    updatedAt: '2026-08-24T11:02:00Z',
    labels: ['work'],
    state: 'closed',
    closedAt: '2026-08-25T09:30:00Z',
    body: `Draft: postmortem template

Replaced by the shared template in the handbook.`
  })
];

function parseSearchQuery(rawQuery) {
  const query = decodeURIComponent(rawQuery || '');
  const state = /is:closed/.test(query) ? 'closed' : 'open';
  const labelName = query.match(/label:"([^"]+)"/)?.[1] || '';
  // repo:, is:, in:, label:, closed: 같은 한정자를 걷어내면 검색어만 남는다.
  const term = query
    .replace(/label:"[^"]*"/g, ' ')
    .replace(/[a-z]+:[^\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { state, labelName, term };
}

function matches(item, { state, labelName, term }) {
  if (item.state !== state) return false;
  if (labelName && !item.labels.some((entry) => entry.name === labelName)) return false;
  if (!term) return true;
  const haystack = `${item.title}\n${item.body}`.toLowerCase();
  return term.toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
}

function sortForState(items, state) {
  return [...items].sort((a, b) => (state === 'closed'
    ? String(b.closed_at || '').localeCompare(String(a.closed_at || ''))
    : String(b.updated_at || '').localeCompare(String(a.updated_at || ''))));
}

export function createFixture() {
  const issues = SEED_ISSUES.map((item) => ({ ...item, labels: [...item.labels] }));
  const labels = LABEL_NAMES.map(label);
  let nextNumber = 143;

  return {
    get issues() {
      return issues;
    },
    get labels() {
      return labels;
    },
    find(number) {
      return issues.find((item) => item.number === Number(number)) || null;
    },
    list({ state = 'open', labelName = '', term = '', page = 1, perPage = 30 }) {
      const filtered = sortForState(issues.filter((item) => matches(item, { state, labelName, term })), state);
      const start = (page - 1) * perPage;
      return { items: filtered.slice(start, start + perPage), total: filtered.length };
    },
    create({ title, body, labels: names = [] }) {
      const now = new Date().toISOString();
      const created = {
        ...issue({ number: nextNumber, body: body || title || '', updatedAt: now, labels: [] }),
        title: title || '',
        body: body || '',
        labels: names.map((name) => (labels.find((entry) => entry.name === name) || label(name)))
      };
      nextNumber += 1;
      issues.unshift(created);
      return created;
    },
    update(number, patch) {
      const target = this.find(number);
      if (!target) return null;
      if (typeof patch.title === 'string') target.title = patch.title;
      if (typeof patch.body === 'string') target.body = patch.body;
      if (Array.isArray(patch.labels)) {
        target.labels = patch.labels.map((name) => (labels.find((entry) => entry.name === name) || label(name)));
      }
      if (patch.state) {
        target.state = patch.state;
        target.closed_at = patch.state === 'closed' ? new Date().toISOString() : null;
      }
      target.updated_at = new Date().toISOString();
      return target;
    },
    createLabel(name) {
      const existing = labels.find((entry) => entry.name === name);
      if (existing) return existing;
      const created = { id: 200 + labels.length, name, color: tagColorForName(name), description: '' };
      labels.push(created);
      return created;
    }
  };
}

// GitHub API 호출을 모두 가로채 더미 저장소로 응답한다.
export async function installGitHubMock(context, fixture) {
  const json = (route, data, status = 200) => route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(data)
  });

  await context.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : {};

    if (path === '/user') {
      return json(route, { login: 'octocat', name: 'Octo Cat', avatar_url: AVATAR });
    }

    if (path === `/repos/${PREVIEW_REPO}`) {
      return json(route, {
        full_name: PREVIEW_REPO,
        name: PREVIEW_REPO.split('/')[1],
        private: true,
        has_issues: true,
        html_url: `https://github.com/${PREVIEW_REPO}`
      });
    }

    if (path === `/repos/${PREVIEW_REPO}/labels` && method === 'GET') {
      return json(route, fixture.labels);
    }

    if (path === `/repos/${PREVIEW_REPO}/labels` && method === 'POST') {
      return json(route, fixture.createLabel(body.name), 201);
    }

    if (path === `/repos/${PREVIEW_REPO}/issues` && method === 'GET') {
      const result = fixture.list({
        state: url.searchParams.get('state') || 'open',
        labelName: url.searchParams.get('labels') || '',
        page: Number(url.searchParams.get('page') || 1),
        perPage: Number(url.searchParams.get('per_page') || 30)
      });
      return json(route, result.items);
    }

    if (path === `/repos/${PREVIEW_REPO}/issues` && method === 'POST') {
      return json(route, fixture.create(body), 201);
    }

    if (path === '/search/issues') {
      const parsed = parseSearchQuery(url.searchParams.get('q'));
      const result = fixture.list({
        ...parsed,
        page: Number(url.searchParams.get('page') || 1),
        perPage: Number(url.searchParams.get('per_page') || 30)
      });
      return json(route, { total_count: result.total, incomplete_results: false, items: result.items });
    }

    const issueMatch = path.match(new RegExp(`^/repos/${PREVIEW_REPO}/issues/(\\d+)$`));
    if (issueMatch) {
      if (method === 'PATCH') return json(route, fixture.update(issueMatch[1], body));
      return json(route, fixture.find(issueMatch[1]) || {}, fixture.find(issueMatch[1]) ? 200 : 404);
    }

    if (/\/issues\/\d+\/comments$/.test(path)) {
      return json(route, method === 'POST' ? { id: 1, html_url: '' } : []);
    }

    if (path.startsWith(`/repos/${PREVIEW_REPO}/contents/`)) {
      return json(route, { message: 'Not Found' }, 404);
    }

    return json(route, {}, 200);
  });

  // 아바타 등 외부 이미지 요청은 네트워크로 나가지 않게 막는다.
  await context.route('https://avatars.githubusercontent.com/**', (route) => route.abort());
}

export const previewSettings = (language = 'en') => ({
  repo: PREVIEW_REPO,
  token: PREVIEW_TOKEN,
  preferences: {
    titleMode: 'first-line',
    editorFont: 'system',
    editorFontSize: 16,
    editorLineHeight: 1.7,
    autoSaveSeconds: 5,
    issuePageSize: 30,
    backgroundRefreshMinutes: 0,
    language
  }
});
