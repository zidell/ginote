#!/usr/bin/env node
// Swift가 만든 잠금 암호문을 웹 코드로 풀어 본다. 표준 입력: [{ pepper, pin, issue, payload, body }]
// 모두 풀리고 본문이 같으면 0으로 끝난다. Swift 호환 테스트가 부른다.
import { loadNoteLock } from './web-modules.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const cases = JSON.parse(input);
let failures = 0;
for (const item of cases) {
  const lock = await loadNoteLock(item.pepper || '');
  try {
    const body = await lock.decryptLockedBody(item.payload, item.pin, item.issue);
    if (body !== item.body) { failures += 1; console.error(`body mismatch for issue ${item.issue}`); }
  } catch (reason) {
    failures += 1;
    console.error(`could not decrypt issue ${item.issue}: ${reason.message}`);
  }
}
if (failures) process.exit(1);
console.log(`decrypted ${cases.length} Swift payloads`);
