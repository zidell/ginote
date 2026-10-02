import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeyboardReadyClass } from './keyboard-ready-class.js';

let frames;
let touch;
let detach;

function flushFrames() {
  const pending = frames;
  frames = new Map();
  for (const callback of pending.values()) callback();
}

beforeEach(() => {
  frames = new Map();
  let nextId = 1;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
  touch = false;
  detach = createKeyboardReadyClass(() => touch).attach();
});

afterEach(() => {
  detach();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function ready() {
  return document.body.classList.contains('keyboard-shortcuts-ready');
}

describe('keyboard-ready-class', () => {
  it('입력창 밖에 있을 때만 단축키 표시를 켠다', () => {
    flushFrames();
    expect(ready()).toBe(true);

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    flushFrames();
    expect(ready()).toBe(false);

    input.blur();
    flushFrames();
    expect(ready()).toBe(true);
  });

  it('터치 기기에서는 켜지 않는다', () => {
    touch = true;
    flushFrames();
    expect(ready()).toBe(false);
  });

  it('포커스 변화가 몰려도 한 프레임에 한 번만 계산한다', () => {
    flushFrames();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    button.blur();
    button.focus();
    expect(frames.size).toBe(1);
  });

  it('창이 포커스를 잃으면 바로 끄고, 멈추면 이벤트도 더는 받지 않는다', () => {
    flushFrames();
    window.dispatchEvent(new Event('blur'));
    expect(ready()).toBe(false);

    detach();
    window.dispatchEvent(new Event('focus'));
    expect(frames.size).toBe(0);
    detach = () => {};
  });
});
