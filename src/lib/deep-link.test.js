import { describe, expect, it, vi } from 'vitest';
import { watchDeepLinks } from './deep-link.js';

function fakeShell(batches) {
  let notify;
  return {
    invoke: vi.fn(async (command) => {
      expect(command).toBe('deep_link_take');
      return batches.shift() || [];
    }),
    listen: vi.fn(async (event, handler) => {
      expect(event).toBe('deep-link-received');
      notify = handler;
      return vi.fn();
    }),
    notify: () => notify()
  };
}

describe('watchDeepLinks', () => {
  it('시작할 때 쌓인 링크와 이후 알림으로 온 링크를 차례로 넘긴다', async () => {
    const shell = fakeShell([['ginote://a'], ['ginote://b', 'ginote://c']]);
    const onLink = vi.fn();
    watchDeepLinks(onLink, { ...shell, isTauri: true });
    await vi.waitFor(() => expect(onLink).toHaveBeenCalledWith('ginote://a'));
    shell.notify();
    await vi.waitFor(() => expect(onLink.mock.calls.map(([url]) => url)).toEqual(['ginote://a', 'ginote://b', 'ginote://c']));
  });

  it('옛 셸이나 웹 브라우저에서는 조용히 넘어간다', async () => {
    const onLink = vi.fn();
    const invoke = vi.fn(async () => { throw new Error('command deep_link_take not found'); });
    watchDeepLinks(onLink, { invoke, listen: async () => () => {}, isTauri: true });
    await Promise.resolve();
    expect(onLink).not.toHaveBeenCalled();

    const browserInvoke = vi.fn();
    watchDeepLinks(onLink, { invoke: browserInvoke, listen: vi.fn(), isTauri: false })();
    expect(browserInvoke).not.toHaveBeenCalled();
  });

  it('멈춘 뒤에는 링크를 넘기지 않고 알림 구독을 푼다', async () => {
    const shell = fakeShell([[], ['ginote://late']]);
    const onLink = vi.fn();
    const stop = watchDeepLinks(onLink, { ...shell, isTauri: true });
    await vi.waitFor(() => expect(shell.listen).toHaveBeenCalled());
    const unlisten = await shell.listen.mock.results[0].value;
    stop();
    shell.notify();
    await Promise.resolve();
    expect(onLink).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalled();
  });
});
