// 앱 프론트엔드 자동 교체(OTA) 매니페스트에 서명할 Ed25519 키 쌍을 만든다.
//
// 개인키는 화면에 출력하지 않고 지정한 파일에만 쓴다(권한 600). 그 파일 내용을 웹 빌드
// 환경의 GINOTE_OTA_SIGNING_KEY 시크릿으로 등록한다. 공개키는 화면에 출력하며
// src-tauri/src/ota.rs 의 OTA_PUBLIC_KEY 에 넣는다. 공개키는 저장소에 들어가도 된다.
//
// 실행: node scripts/generate-ota-key.mjs <개인키를 쓸 경로>
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!target) {
  console.error('사용법: node scripts/generate-ota-key.mjs <개인키를 쓸 경로>');
  process.exit(1);
}
if (existsSync(target)) {
  console.error(`${target} 파일이 이미 있습니다. 기존 키를 덮어쓰지 않습니다.`);
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
writeFileSync(target, `${privateDer}\n`, { mode: 0o600 });

// JWK의 x는 32바이트 공개키를 base64url로 담는다. Rust 쪽은 표준 base64를 읽는다.
const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
console.log(`개인키를 ${target}에 썼습니다.`);
console.log(`공개키(OTA_PUBLIC_KEY): ${raw.toString('base64')}`);
