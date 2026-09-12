<script>
  import { onMount, onDestroy } from 'svelte';
  import { transcribeAudio, refineTranscript } from './openai-voice.js';

  let { apiKey, refinementPrompt = '', transcriptionModel = 'gpt-transcribe', refinementModel = 'gpt-4o-mini', onComplete, onClose, onDirtyChange = () => {} } = $props();
  let recorder;
  let stream;
  let audioContext;
  let analyser;
  let animationFrame;
  let chunks = [];
  let canvas;
  let dialogElement;
  let recordButton;
  let abortController;
  let elapsedSeconds = $state(0);
  let elapsedInterval;
  let elapsedStartedAt = 0;
  let elapsedMilliseconds = $state(0);
  let recording = $state(false);
  let preparing = $state(true);
  let processing = $state(false);
  let error = $state('');
  let status = $state('마이크를 준비하고 있습니다…');

  onMount(() => {
    dialogElement?.showModal();
    recordButton?.focus();
    window.addEventListener('voice-close-request', requestClose);
    void prepareMicrophone();
    return () => window.removeEventListener('voice-close-request', requestClose);
  });
  onDestroy(stopEverything);

  function stopEverything() {
    abortController?.abort();
    clearInterval(elapsedInterval);
    cancelAnimationFrame(animationFrame);
    if (recorder?.state === 'recording') recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    audioContext?.close?.();
  }

  async function ensureMicrophone() {
    if (stream) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error('이 기기 또는 브라우저에서는 음성 녹음을 지원하지 않습니다.');
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    drawWaveform();
  }

  async function prepareMicrophone() {
    try {
      await ensureMicrophone();
      if (audioContext?.state === 'suspended') await audioContext.resume();
      status = '녹음을 시작하는 중…';
    } catch (reason) {
      error = reason?.name === 'NotAllowedError'
        ? '마이크 권한이 필요합니다. 브라우저 또는 시스템 설정에서 마이크를 허용해 주세요.'
        : (reason?.message || '마이크를 시작하지 못했습니다.');
      status = '마이크를 사용할 수 없습니다.';
    } finally {
      preparing = false;
      if (!error) void startRecording();
    }
  }

  async function startRecording() {
    if (processing || recording) return;
    error = '';
    preparing = true;
    try {
      if (recorder?.state === 'paused') {
        recorder.resume();
        recording = true;
        startElapsedTimer();
        status = '녹음 중';
        return;
      }
      await ensureMicrophone();
      if (audioContext?.state === 'suspended') await audioContext.resume();
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => { recording = false; status = chunks.length ? '재개하시거나 완료하세요.' : '녹음이 멈췄습니다.'; };
      recorder.start();
      recording = true;
      startElapsedTimer();
      onDirtyChange(true);
      status = '녹음 중';
    } catch (reason) {
      error = reason?.name === 'NotAllowedError'
        ? '마이크 권한이 필요합니다. 브라우저 또는 시스템 설정에서 마이크를 허용해 주세요.'
        : (reason?.message || '마이크를 시작하지 못했습니다.');
      status = '녹음을 시작할 수 없습니다.';
    } finally { preparing = false; }
  }

  function stopRecording() {
    if (recorder?.state !== 'recording') return Promise.resolve();
    recorder.pause();
    recording = false;
    pauseElapsedTimer();
    status = '재개하시거나 완료하세요.';
    return Promise.resolve();
  }

  function updateElapsedSeconds() {
    const activeMilliseconds = elapsedStartedAt ? Date.now() - elapsedStartedAt : 0;
    elapsedSeconds = Math.floor((elapsedMilliseconds + activeMilliseconds) / 1000);
  }

  function startElapsedTimer() {
    elapsedStartedAt = Date.now();
    updateElapsedSeconds();
    clearInterval(elapsedInterval);
    elapsedInterval = setInterval(updateElapsedSeconds, 250);
  }

  function pauseElapsedTimer() {
    if (elapsedStartedAt) elapsedMilliseconds += Date.now() - elapsedStartedAt;
    elapsedStartedAt = 0;
    clearInterval(elapsedInterval);
    updateElapsedSeconds();
  }

  function drawWaveform() {
    if (!canvas || !analyser) return;
    const context = canvas.getContext('2d');
    const values = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      animationFrame = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(values);
      const { width, height } = canvas;
      context.clearRect(0, 0, width, height);
      context.strokeStyle = recording ? '#ef4444' : '#64748b';
      context.lineWidth = 2;
      context.beginPath();
      values.forEach((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = (value / 255) * height;
        index ? context.lineTo(x, y) : context.moveTo(x, y);
      });
      context.stroke();
    };
    draw();
  }

  async function submit() {
    if (recorder && recorder.state !== 'inactive') {
      const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
      if (recorder.state === 'paused') recorder.resume();
      recorder.stop();
      await stopped;
      pauseElapsedTimer();
    }
    if (!chunks.length || processing) { error = '먼저 음성을 녹음해 주세요.'; return; }
    processing = true; error = '';
    onDirtyChange(false);
    abortController = new AbortController();
    try {
      status = '음성을 텍스트로 변환하는 중…';
      const audio = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
      const transcript = await transcribeAudio(apiKey, audio, transcriptionModel, abortController.signal);
      if (!transcript) throw new Error('음성에서 텍스트를 찾지 못했습니다.');
      let body = transcript;
      if (refinementPrompt.trim()) {
        status = '텍스트를 정제하는 중…';
        body = await refineTranscript(apiKey, transcript, refinementPrompt, refinementModel, abortController.signal);
      }
      if (!body) throw new Error('정제된 텍스트가 비어 있습니다.');
      status = '노트에 기록하는 중…';
      await onComplete(body);
    } catch (reason) {
      if (reason?.name !== 'AbortError') error = reason?.message || '음성 기록에 실패했습니다.';
      if (reason?.name !== 'AbortError') onDirtyChange(true);
      status = '다시 시도할 수 있습니다.';
    } finally { processing = false; abortController = null; }
  }

  function requestClose() {
    if (elapsedMilliseconds || elapsedStartedAt) {
      if (!confirm('기록하지 않은 녹음을 전부 취소하시겠습니까?')) return;
    }
    onDirtyChange(false);
    onClose();
  }
</script>

<dialog bind:this={dialogElement} class="voice-modal" aria-label="음성 녹음" oncancel={(event) => { event.preventDefault(); if (!processing) requestClose(); }}>
    <button class="btn btn-sm btn-outline-secondary voice-close" aria-label="닫기" onclick={requestClose} disabled={processing}><i class="bi bi-x-lg"></i></button>
    <div class="voice-content">
      <div class="voice-recording-control">
        <canvas class="voice-waveform" width="480" height="120" bind:this={canvas} aria-label="녹음 파형"></canvas>
        <button
          bind:this={recordButton}
          class="voice-record-button"
          class:is-recording={recording}
          aria-label={recording ? '녹음 중지' : '녹음 시작'}
          title={recording ? '녹음 중지' : '녹음 시작'}
          onclick={recording ? stopRecording : startRecording}
          disabled={preparing || processing}
        >
          <i class={`bi ${recording ? 'bi-stop-fill' : 'bi-mic-fill'}`} aria-hidden="true"></i>
        </button>
      </div>
      <p class="voice-status" role="status">{status}</p>
      {#if error}<p class="voice-error" role="alert">{error}</p>{/if}
    </div>
    <div class="voice-footer"><button class="btn btn-primary" onclick={submit} disabled={preparing || processing || (!recording && !chunks.length && !elapsedMilliseconds)}>{processing ? '기록 중…' : `완료 (${elapsedSeconds}초)`}</button></div>
</dialog>
