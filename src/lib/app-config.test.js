import { describe, expect, it } from 'vitest';
import { ConfigSyntaxError, defaultSnapshot, parseConfig, renderConfig, renderStatus } from './app-config.js';

function sampleSnapshot() {
  const snapshot = defaultSnapshot();
  snapshot.workspaces = [
    { id: 'ws-1', repo: 'octo/notes', displayName: 'Personal', rememberToken: true, token: 'github_pat_secret' },
    { id: 'ws-2', repo: 'octo/work', displayName: '', rememberToken: false, token: '' }
  ];
  snapshot.activeWorkspaceId = 'ws-2';
  snapshot.preferences = {
    ...snapshot.preferences,
    theme: 'light',
    language: 'ko',
    editorFont: 'local:Menlo',
    editorLineHeight: 1.65,
    listRowFields: { title: true, summary: false, meta: true, tags: false }
  };
  snapshot.voice = { ...snapshot.voice, apiKey: 'sk-secret', refinementModel: '', refinementPrompt: '첫 줄\n둘째 줄' };
  snapshot.sidebarWidth = 420;
  return snapshot;
}

describe('config.toml', () => {
  it('round-trips every setting and never writes credentials', () => {
    const snapshot = sampleSnapshot();
    const text = renderConfig(snapshot);

    expect(text).not.toContain('github_pat_secret');
    expect(text).not.toContain('sk-secret');
    const { snapshot: parsed, problems, rewrite } = parseConfig(text);
    expect(problems).toEqual([]);
    expect(rewrite).toBe(false);
    expect(parsed).toEqual({
      ...snapshot,
      workspaces: snapshot.workspaces.map((workspace) => ({ ...workspace, token: '' })),
      voice: { ...snapshot.voice, apiKey: '' }
    });
  });

  it('documents each key next to its value', () => {
    const text = renderConfig(sampleSnapshot());
    expect(text).toMatch(/# Editor font size in px\. Integer 12\.\.32\. Default: 17\.[^\n]*\neditor_font_size = 17/);
    expect(text).toContain('config-status.txt');
    expect(text).toContain('are NOT in this file');
  });

  it('replaces values outside the allowed range and reports each one', () => {
    const { snapshot, problems } = parseConfig([
      '[display]',
      'theme = "blue"',
      'editor_font_size = 99',
      'editor_font = "Comic Sans"',
      '[behavior]',
      'lock_session_minutes = 7',
      'notes_per_page = "many"'
    ].join('\n'));

    expect(snapshot.preferences).toMatchObject({
      theme: 'dark',
      editorFontSize: 32,
      editorFont: 'system',
      lockSessionMinutes: 60,
      issuePageSize: 30
    });
    expect(problems).toHaveLength(5);
    expect(problems[0]).toMatch(/^display\.theme = "blue" is not allowed; using "dark"\./);
  });

  it('keeps values that are written as other valid TOML numbers', () => {
    const { snapshot, problems } = parseConfig('[display]\neditor_line_height = 2\n');
    expect(snapshot.preferences.editorLineHeight).toBe(2);
    expect(problems).toEqual([]);
  });

  it('assigns ids to new workspaces, drops invalid ones and falls back to the first workspace', () => {
    const ids = ['new-1', 'new-2'];
    const { snapshot, problems, rewrite } = parseConfig([
      'active_workspace = "missing"',
      '[[workspaces]]',
      'repo = "https://github.com/octo/notes.git"',
      '[[workspaces]]',
      'repo = "not a repo"',
      '[[workspaces]]',
      'id = "ws-9"',
      'repo = "octo/work"',
      'remember_token = false'
    ].join('\n'), () => ids.shift());

    expect(rewrite).toBe(true);
    expect(snapshot.workspaces).toEqual([
      { id: 'new-1', repo: 'octo/notes', displayName: '', rememberToken: true, token: '' },
      { id: 'ws-9', repo: 'octo/work', displayName: '', rememberToken: false, token: '' }
    ]);
    expect(snapshot.activeWorkspaceId).toBe('new-1');
    expect(problems.join('\n')).toMatch(/workspaces\[1\]\.repo = "not a repo"/);
    expect(problems.join('\n')).toMatch(/active_workspace = "missing" matches no workspace/);
  });

  it('reports unknown keys instead of silently ignoring them', () => {
    const { problems } = parseConfig('colour = "red"\n[display]\nfont_size = 12\n[display.list_row]\nauthor = true\n');
    expect(problems).toEqual([
      'Unknown key "colour" is ignored.',
      'Unknown key "display.font_size" is ignored.',
      'Unknown key "display.list_row.author" is ignored.'
    ]);
  });

  it('throws a syntax error with the line number for invalid TOML', () => {
    let failure;
    try {
      parseConfig('[display]\ntheme = \n');
    } catch (reason) {
      failure = reason;
    }
    expect(failure).toBeInstanceOf(ConfigSyntaxError);
    expect(failure.line).toBe(2);
  });

  it('writes prompts that contain triple quotes as escaped strings', () => {
    const snapshot = sampleSnapshot();
    snapshot.voice.refinementPrompt = "use '''quotes'''\nand \"these\"";
    expect(parseConfig(renderConfig(snapshot)).snapshot.voice.refinementPrompt).toBe("use '''quotes'''\nand \"these\"");
  });

  it('summarises the last load in the status file', () => {
    expect(renderStatus({ loadedAt: '2026-10-03T00:00:00.000Z' })).toContain('every value was accepted');
    expect(renderStatus({ loadedAt: 'x', problems: ['a'] })).toContain('- a');
    expect(renderStatus({ loadedAt: 'x', syntaxError: new ConfigSyntaxError('bad', 2) }))
      .toContain('previous settings are still in effect');
  });
});
