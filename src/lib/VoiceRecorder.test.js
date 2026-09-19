import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./openai-voice.js', () => ({
  transcribeAudio: vi.fn(),
  refineTranscript: vi.fn()
}));

import VoiceRecorder from './VoiceRecorder.svelte';
import { refineTranscript, transcribeAudio } from './openai-voice.js';

// 브라우저 녹음 API를 흉내 낸다. stop()은 실제 MediaRecorder처럼 dataavailable → stop 순으로 알린다.
class FakeMediaRecorder {
  static instances = [];
  static isTypeSupported(type) {
    return type === 'audio/webm;codecs=opus';
  }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.options = options;
    this.mimeType = options.mimeType || '';
    this.state = 'inactive';
    this.listeners = new Map();
    FakeMediaRecorder.instances.push(this);
  }

  start() { this.state = 'recording'; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }

  stop() {
    this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) });
    this.state = 'inactive';
    const event = new Event('stop');
    this.onstop?.(event);
    for (const [listener, once] of this.listeners.get('stop') || []) {
      listener(event);
      if (once) this.listeners.get('stop').delete(listener);
    }
  }

  addEventListener(type, listener, options = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Map());
    this.listeners.get(type).set(listener, Boolean(options.once));
  }
}

function fakeAudioNode() {
  const node = { connect: vi.fn(() => node), start: vi.fn(), stop: vi.fn() };
  return node;
}

class FakeAudioContext {
  static instances = [];
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.close = vi.fn();
    this.resume = vi.fn();
    FakeAudioContext.instances.push(this);
  }
  createAnalyser() { return { fftSize: 0, frequencyBinCount: 4, getByteTimeDomainData: vi.fn() }; }
  createMediaStreamSource() { return fakeAudioNode(); }
  createOscillator() { return { ...fakeAudioNode(), frequency: { value: 0, setValueAtTime: vi.fn() } }; }
  createGain() { return { ...fakeAudioNode(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }; }
}

let track;
let getUserMedia;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeAudioContext.instances = [];
  track = { stop: vi.fn() };
  getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn()
  });
  HTMLDialogElement.prototype.showModal ??= function showModal() { this.open = true; };
  URL.createObjectURL = vi.fn(() => 'blob:voice');
  URL.revokeObjectURL = vi.fn();
  transcribeAudio.mockReset();
  refineTranscript.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderRecorder(props = {}) {
  const handlers = {
    onComplete: vi.fn(async () => {}),
    onClose: vi.fn(),
    onDirtyChange: vi.fn()
  };
  render(VoiceRecorder, { apiKey: 'sk-test', ...handlers, ...props });
  return { ...handlers, ...props };
}

async function waitForRecording() {
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('녹음 중'));
  return FakeMediaRecorder.instances.at(-1);
}

function finishButton() {
  return screen.getByRole('button', { name: /완료|기록 중/ });
}

describe('VoiceRecorder', () => {
  it('열리자마자 마이크를 준비하고 녹음을 시작한다', async () => {
    const { onDirtyChange } = renderRecorder();
    const recorder = await waitForRecording();

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(recorder.state).toBe('recording');
    expect(recorder.options).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 16_000 });
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: '녹음 일시정지' })).toBeTruthy();
  });

  it('녹음을 멈췄다가 같은 녹음기로 이어서 녹음한다', async () => {
    renderRecorder();
    const recorder = await waitForRecording();

    await fireEvent.click(screen.getByRole('button', { name: '녹음 일시정지' }));
    expect(recorder.state).toBe('paused');
    expect(screen.getByRole('status').textContent).toBe('재개하시거나 완료하세요.');

    await fireEvent.click(screen.getByRole('button', { name: '녹음 시작' }));
    await waitForRecording();
    expect(recorder.state).toBe('recording');
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it('녹음 기능이 없는 브라우저에서는 이유를 알리고 녹음하지 않는다', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    renderRecorder();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('음성 녹음을 지원하지 않습니다'));
    expect(screen.getByRole('status').textContent).toBe('마이크를 사용할 수 없습니다.');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('마이크 권한을 거부하면 권한 안내를 보여준다', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    renderRecorder();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('마이크 권한이 필요합니다'));
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('완료하면 전사·정제 결과를 노트에 기록하고, 기록 전에 미저장 상태를 해제한다', async () => {
    transcribeAudio.mockResolvedValue('원문 전사');
    refineTranscript.mockResolvedValue({ body: '정제된 본문', tags: ['회의'], title: '회의 메모' });
    const events = [];
    const { onComplete } = renderRecorder({
      refinementPrompt: '짧게',
      transcriptionModel: 'gpt-4o-transcribe',
      transcriptionLanguage: 'ko',
      transcriptionHints: 'Ginote',
      refinementModel: 'gpt-4o-mini',
      availableTags: ['회의', '할일'],
      onDirtyChange: vi.fn((value) => events.push(`dirty:${value}`)),
      onComplete: vi.fn(async () => { events.push('complete'); })
    });
    await waitForRecording();

    await fireEvent.click(finishButton());

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const [body, blob, tags, title] = onComplete.mock.calls[0];
    expect([body, tags, title]).toEqual(['정제된 본문', ['회의'], '회의 메모']);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/webm;codecs=opus');
    expect(transcribeAudio).toHaveBeenCalledWith('sk-test', blob, 'gpt-4o-transcribe', expect.any(AbortSignal), 'ko', 'Ginote');
    expect(refineTranscript).toHaveBeenCalledWith('sk-test', '원문 전사', '짧게', 'gpt-4o-mini', expect.any(AbortSignal), ['회의', '할일']);
    expect(events.slice(-2)).toEqual(['dirty:false', 'complete']);
  });

  it('정제 모델을 비워 두면 전사문만 기록한다', async () => {
    transcribeAudio.mockResolvedValue('원문 전사');
    const { onComplete } = renderRecorder({ refinementModel: '  ' });
    await waitForRecording();

    await fireEvent.click(finishButton());

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('원문 전사', expect.any(Blob), [], ''));
    expect(refineTranscript).not.toHaveBeenCalled();
  });

  it('일시정지 상태에서 완료해도 녹음기를 끝까지 멈추고 기록한다', async () => {
    transcribeAudio.mockResolvedValue('원문');
    const { onComplete } = renderRecorder({ refinementModel: '' });
    const recorder = await waitForRecording();
    await fireEvent.click(screen.getByRole('button', { name: '녹음 일시정지' }));

    await fireEvent.click(finishButton());

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(recorder.state).toBe('inactive');
  });

  it('전사가 한 번 실패하면 한 번 더 시도한다', async () => {
    transcribeAudio.mockRejectedValueOnce(new Error('일시 오류')).mockResolvedValueOnce('두 번째 성공');
    const { onComplete } = renderRecorder({ refinementModel: '' });
    await waitForRecording();

    await fireEvent.click(finishButton());

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('두 번째 성공', expect.any(Blob), [], ''));
    expect(transcribeAudio).toHaveBeenCalledTimes(2);
  });

  it('재시도까지 실패하면 오류를 보여주고 원본 음성을 내려받을 수 있게 한다', async () => {
    transcribeAudio.mockRejectedValue(new Error('OpenAI 응답 없음'));
    const { onComplete, onDirtyChange } = renderRecorder({ refinementModel: '' });
    await waitForRecording();

    await fireEvent.click(finishButton());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('OpenAI 응답 없음'));
    expect(transcribeAudio).toHaveBeenCalledTimes(2);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: /원본 음성 다운로드/ })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('다시 시도할 수 있습니다.');
  });

  it('노트 저장이 실패해도 녹음을 잃지 않고 다시 미저장 상태로 돌린다', async () => {
    transcribeAudio.mockResolvedValue('원문');
    const { onDirtyChange } = renderRecorder({
      refinementModel: '',
      onComplete: vi.fn(async () => { throw new Error('GitHub 저장 실패'); })
    });
    await waitForRecording();

    await fireEvent.click(finishButton());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('GitHub 저장 실패'));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: /원본 음성 다운로드/ })).toBeTruthy();
  });

  it('전사 결과가 비어 있으면 기록하지 않는다', async () => {
    transcribeAudio.mockResolvedValue('');
    const { onComplete } = renderRecorder({ refinementModel: '' });
    await waitForRecording();

    await fireEvent.click(finishButton());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('음성에서 텍스트를 찾지 못했습니다.'));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('정제 결과에 본문도 태그도 없으면 기록하지 않는다', async () => {
    transcribeAudio.mockResolvedValue('원문');
    refineTranscript.mockResolvedValue({ body: '', tags: [], title: '' });
    const { onComplete } = renderRecorder();
    await waitForRecording();

    await fireEvent.click(finishButton());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('모두 비어 있습니다'));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('녹음한 내용이 있으면 닫기 전에 확인하고, 취소하면 닫지 않는다', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { onClose } = renderRecorder();
    await waitForRecording();

    await fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    window.dispatchEvent(new Event('voice-close-request'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('녹음이 시작되지 않았으면 확인 없이 닫는다', async () => {
    getUserMedia.mockRejectedValue(new Error('장치 없음'));
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { onClose, onDirtyChange } = renderRecorder();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('장치 없음'));

    await fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('닫히면 마이크와 오디오 자원을 정리한다', async () => {
    renderRecorder();
    const recorder = await waitForRecording();

    cleanup();

    expect(recorder.state).toBe('inactive');
    expect(track.stop).toHaveBeenCalled();
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
  });

  it('최대 녹음 시간(1시간)에 도달하면 자동으로 멈추고 기록한다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    transcribeAudio.mockResolvedValue('긴 회의');
    const { onComplete } = renderRecorder({ refinementModel: '' });
    const recorder = await waitForRecording();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith('긴 회의', expect.any(Blob), [], ''));
    expect(recorder.state).toBe('inactive');
  });
});
