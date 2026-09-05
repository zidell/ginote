// 시간 기반 녹화 대신, 화면이 바뀔 때마다 한 장씩 캡처하고
// 프레임마다 재생 시간을 직접 지정한다. 캡처가 느려도 결과 GIF의
// 속도는 일정하고, 중간 상태가 빠지지 않는다.
import fs from 'node:fs/promises';
import path from 'node:path';

const CURSOR_SCRIPT = `
(() => {
  const install = () => {
    if (document.getElementById('preview-cursor')) return;
    const style = document.createElement('style');
    style.textContent = \`
      #preview-cursor {
        position: fixed; left: 0; top: 0; width: 26px; height: 26px;
        z-index: 2147483647; pointer-events: none; will-change: transform;
        transform: translate3d(-100px, -100px, 0);
      }
      #preview-cursor .preview-cursor-arrow {
        position: absolute; inset: 0; transform-origin: 4px 4px;
        transition: transform 80ms ease-out;
      }
      #preview-cursor.is-pressed .preview-cursor-arrow { transform: scale(0.82); }
      #preview-cursor .preview-cursor-ring {
        position: absolute; left: 2px; top: 2px; width: 4px; height: 4px;
        border-radius: 50%; border: 2px solid rgba(120, 170, 255, 0.9);
        transform: translate(-50%, -50%) scale(1); opacity: 0;
      }
      #preview-cursor.is-rippling .preview-cursor-ring { opacity: 1; }
    \`;
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = 'preview-cursor';
    cursor.innerHTML = \`
      <span class="preview-cursor-ring"></span>
      <svg class="preview-cursor-arrow" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path d="M4 2 L4 20 L9 15.4 L12.2 22 L15.6 20.4 L12.4 14 L19 13.6 Z"
          fill="#ffffff" stroke="rgba(0,0,0,0.65)" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>\`;
    document.body.appendChild(cursor);

    const ring = cursor.querySelector('.preview-cursor-ring');
    window.__previewCursor = {
      move(x, y) {
        cursor.style.transform = \`translate3d(\${x}px, \${y}px, 0)\`;
      },
      press() { cursor.classList.add('is-pressed'); },
      release() { cursor.classList.remove('is-pressed'); },
      ripple(size, opacity) {
        cursor.classList.toggle('is-rippling', opacity > 0);
        ring.style.transform = \`translate(-50%, -50%) scale(\${size})\`;
        ring.style.opacity = String(opacity);
      }
    };
  };

  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
})();
`;

const easeInOut = (ratio) => (ratio < 0.5
  ? 4 * ratio * ratio * ratio
  : 1 - Math.pow(-2 * ratio + 2, 3) / 2);

export async function createRecorder(page, { frameDir, frameMs = 40 }) {
  await fs.rm(frameDir, { recursive: true, force: true });
  await fs.mkdir(frameDir, { recursive: true });

  const frames = [];
  let cursorPosition = { x: 40, y: 620 };

  const capture = async (durationMs = frameMs) => {
    const file = `frame-${String(frames.length + 1).padStart(5, '0')}.png`;
    await page.screenshot({ path: path.join(frameDir, file) });
    frames.push({ file, durationMs: Math.max(20, Math.round(durationMs)) });
    return file;
  };

  // 마지막 프레임을 더 오래 보여준다. 같은 그림을 다시 저장하지 않는다.
  const hold = (durationMs) => {
    if (!frames.length) return;
    frames[frames.length - 1].durationMs += Math.max(0, Math.round(durationMs));
  };

  const moveCursor = async (x, y) => {
    cursorPosition = { x, y };
    await page.evaluate(([left, top]) => window.__previewCursor?.move(left, top), [x, y]);
    await page.mouse.move(x, y);
  };

  const targetPoint = async (target) => {
    if (typeof target !== 'string') return target;
    const box = await page.locator(target).first().boundingBox();
    if (!box) throw new Error(`대상을 찾지 못했습니다: ${target}`);
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  };

  const moveTo = async (target, { steps = 14, stepMs = frameMs } = {}) => {
    const destination = await targetPoint(target);
    const origin = { ...cursorPosition };
    const distance = Math.hypot(destination.x - origin.x, destination.y - origin.y);
    const totalSteps = Math.max(4, Math.min(steps, Math.round(distance / 24) + 4));
    for (let step = 1; step <= totalSteps; step++) {
      const ratio = easeInOut(step / totalSteps);
      await moveCursor(
        Math.round(origin.x + (destination.x - origin.x) * ratio),
        Math.round(origin.y + (destination.y - origin.y) * ratio)
      );
      await capture(stepMs);
    }
    return destination;
  };

  const clickEffect = async () => {
    await page.evaluate(() => window.__previewCursor?.press());
    await page.evaluate(() => window.__previewCursor?.ripple(1, 0.9));
    await capture(frameMs);
    await page.evaluate(() => window.__previewCursor?.ripple(4.5, 0.6));
    await capture(frameMs);
    await page.evaluate(() => window.__previewCursor?.release());
    await page.evaluate(() => window.__previewCursor?.ripple(8, 0));
  };

  const click = async (target, { steps, settleMs = 220, settleFps = 20 } = {}) => {
    const point = await moveTo(target, { steps });
    await clickEffect();
    if (typeof target === 'string') await page.locator(target).first().click();
    else await page.mouse.click(point.x, point.y);
    await track(settleMs, { fps: settleFps });
  };

  // 클릭 직후처럼 앱이 스스로 바뀌는 구간은 짧게 연속 캡처해 중간 상태를 남긴다.
  const track = async (durationMs, { fps = 20 } = {}) => {
    const interval = 1000 / fps;
    const count = Math.max(1, Math.round(durationMs / interval));
    for (let index = 0; index < count; index++) {
      await capture(interval);
    }
  };

  const isCursorInside = (box) => Boolean(box)
    && cursorPosition.x >= box.x && cursorPosition.x <= box.x + box.width
    && cursorPosition.y >= box.y && cursorPosition.y <= box.y + box.height;

  const type = async (selector, text, { charsPerFrame = 1, charMs = 55, pauseMs = 260 } = {}) => {
    const field = page.locator(selector).first();
    // 아직 커서가 입력란 밖이면 먼저 옮기고 눌러, 어디에 쓰는지 보이게 한다.
    if (!isCursorInside(await field.boundingBox())) {
      await moveTo(selector);
      await clickEffect();
    }
    await field.click();
    await capture(frameMs);
    const characters = Array.from(text);
    let pending = 0;
    for (let index = 0; index < characters.length; index++) {
      const character = characters[index];
      // 특수 문자도 그대로 입력하기 위해 키 이름 대신 문자 삽입을 쓴다.
      if (character === '\n') await page.keyboard.press('Enter');
      else await page.keyboard.insertText(character);
      pending += 1;
      const isBreak = character === '\n';
      const isLast = index === characters.length - 1;
      if (pending >= charsPerFrame || isBreak || isLast) {
        await capture(charMs * pending);
        pending = 0;
      }
      if (isBreak) hold(pauseMs);
    }
  };

  return {
    frames,
    capture,
    hold,
    track,
    moveTo,
    click,
    type,
    async waitFor(selector, options = {}) {
      await page.locator(selector).first().waitFor({ state: 'visible', timeout: 15_000, ...options });
    },
    async placeCursor(x, y) {
      await moveCursor(x, y);
    },
    async writeManifest() {
      const manifest = frames.map((frame) => ({ ...frame }));
      await fs.writeFile(path.join(frameDir, 'frames.json'), JSON.stringify(manifest, null, 2));
      return manifest;
    }
  };
}

export const cursorInitScript = CURSOR_SCRIPT;
