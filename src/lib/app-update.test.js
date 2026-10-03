import { describe, expect, it, vi } from 'vitest';
import { prepareAppUpdate, watchAppUpdate } from './app-update.js';

function fakeTauri(status) {
  let listener;
  const stopListening = vi.fn();
  return {
    invoke: vi.fn(async () => status),
    listen: vi.fn(async (_name, callback) => {
      listener = callback;
      return stopListening;
    }),
    emit: (payload) => listener({ payload }),
    stopListening
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('앱 업데이트 필요 알림', () => {
  it('웹 브라우저에서는 셸에 묻지 않는다', () => {
    const tauri = fakeTauri({ updateRequired: true });
    const notify = vi.fn();
    watchAppUpdate(notify, { ...tauri, isTauri: false });
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('이미 끝난 확인 결과와 나중에 오는 이벤트를 합쳐 한 번만 알린다', async () => {
    const tauri = fakeTauri({ updateRequired: true });
    const notify = vi.fn();
    watchAppUpdate(notify, { ...tauri, isTauri: true });
    await flush();
    tauri.emit({ updateRequired: true });
    expect(tauri.invoke).toHaveBeenCalledWith('ota_status');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('업데이트가 필요 없으면 알리지 않고, 정리하면 이벤트 구독을 끊는다', async () => {
    const tauri = fakeTauri({ updateRequired: false });
    const notify = vi.fn();
    const stop = watchAppUpdate(notify, { ...tauri, isTauri: true });
    await flush();
    stop();
    tauri.emit({ updateRequired: true });
    expect(notify).not.toHaveBeenCalled();
    expect(tauri.stopListening).toHaveBeenCalled();
  });
});

describe('오래된 앱 빌드 먼저 교체', () => {
  it('웹 브라우저에서는 바로 띄운다', async () => {
    const invoke = vi.fn();
    expect(await prepareAppUpdate({ invoke, isTauri: false })).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('업데이트를 최근에 확인했으면 기다리지 않는다', async () => {
    const invoke = vi.fn(async () => ({ stale: false }));
    const onWaiting = vi.fn();
    expect(await prepareAppUpdate({ invoke, isTauri: true, onWaiting })).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('한 달 넘게 확인하지 못했으면 안내를 띄우고 새 빌드 적용 여부를 돌려준다', async () => {
    const invoke = vi.fn(async (command) => (command === 'ota_status' ? { stale: true } : true));
    const onWaiting = vi.fn();
    expect(await prepareAppUpdate({ invoke, isTauri: true, onWaiting })).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('ota_prepare');
    expect(onWaiting).toHaveBeenCalledTimes(1);
  });

  it('셸이 command를 모르거나 오류가 나면 가지고 있는 빌드로 띄운다', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('unknown command');
    });
    expect(await prepareAppUpdate({ invoke, isTauri: true })).toBe(false);
  });
});
