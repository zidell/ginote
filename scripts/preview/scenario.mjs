// 미리보기 GIF의 장면 대본. 동작 하나가 끝날 때마다 프레임을 남기므로
// 로딩·타이핑·드롭다운 같은 중간 상태가 빠지지 않는다.

const NEW_NOTE_TEXT = [
  'Release checklist — 0.4',
  'Freeze the branch on Thursday',
  'Refresh the README preview'
].join('\n');

const ACTIVE_EDITOR = '.note-detail-layer.active';
const SAVE_STATUS = `${ACTIVE_EDITOR} .save-status`;

// 저장이 끝날 때까지는 화면이 거의 그대로다. 프레임을 더 쌓지 않고 기다린다.
const waitForSaved = async (page) => {
  await page.locator(SAVE_STATUS).first().waitFor({ state: 'detached', timeout: 20_000 });
};

export async function runScenario(page, recorder) {
  // 1. 연결된 노트 목록
  await recorder.waitFor('.note-list-row');
  await recorder.placeCursor(150, 700);
  await recorder.capture(80);
  await recorder.hold(800);

  // 2. 노트 열기
  await recorder.click('.note-list-row:has-text("Kyoto")', { settleMs: 400 });
  await recorder.waitFor('.inline-body');
  await recorder.capture(80);
  await recorder.hold(1000);

  // 3. 새 노트 작성
  await recorder.click('.sidebar-new-note button', { settleMs: 500 });
  await recorder.waitFor(`${ACTIVE_EDITOR} .inline-body`);
  await recorder.hold(400);
  await recorder.type(`${ACTIVE_EDITOR} .inline-body`, NEW_NOTE_TEXT, { charMs: 50 });
  await recorder.hold(400);

  // 4. 자동 저장(저장 중 → 이슈 번호 부여)
  await recorder.track(1400, { fps: 10 });
  await waitForSaved(page);
  await recorder.capture(90);
  await recorder.hold(700);

  // 5. 태그 붙이기
  await recorder.click(`${ACTIVE_EDITOR} .detail-toolbar-actions-desktop .tag-picker button`, { settleMs: 300 });
  await recorder.waitFor('.tag-dropdown input');
  await recorder.hold(400);
  await recorder.type('.tag-dropdown input', 'wo', { charMs: 90 });
  await recorder.hold(400);
  await recorder.click('.tag-dropdown-list button', { settleMs: 400 });
  await recorder.hold(500);
  // 본문을 다시 눌러 태그 목록을 닫는다. Escape는 노트까지 닫아 버린다.
  await recorder.click(`${ACTIVE_EDITOR} .inline-body`, { settleMs: 250 });
  await recorder.hold(600);
  await waitForSaved(page);
  await recorder.capture(90);
  await recorder.hold(500);

  // 6. 검색
  await recorder.click('.sidebar-search input', { settleMs: 200 });
  await recorder.type('.sidebar-search input', 'kyoto', { charMs: 85 });
  await recorder.hold(250);
  await page.keyboard.press('Enter');
  await recorder.track(700, { fps: 14 });
  await recorder.hold(900);

  // 7. 검색어를 지우고 태그로 걸러 보기
  await page.keyboard.press('ControlOrMeta+a');
  await recorder.capture(90);
  await page.keyboard.press('Backspace');
  await recorder.capture(90);
  await page.keyboard.press('Enter');
  await recorder.track(700, { fps: 14 });
  await recorder.hold(400);

  await recorder.click('.note-list-row:has-text("Platform sync") .note-row-labels button', { settleMs: 700 });
  await recorder.hold(1000);

  // 8. 휴지통을 둘러보고 목록으로 돌아온다
  await recorder.click('.state-tabs button:nth-child(2)', { settleMs: 800 });
  await recorder.hold(1000);
  await recorder.click('.state-tabs button:nth-child(1)', { settleMs: 800 });
  await recorder.hold(1400);
}
