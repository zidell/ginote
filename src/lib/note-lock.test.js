import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addLockToTitle,
  decryptLockedBody,
  encryptLockedBody,
  isLockedPayload,
  isLockedTitle,
  normalizeLockPin,
  removeLockFromTitle
} from './note-lock.js';

// 앱 코드와 무관하게 Node crypto(pbkdf2Sync + aes-256-gcm)로 저장 형식 스펙대로 만든 고정 벡터다.
// [버전 0x02][salt 16B = 01..10][iv 12B = a0..ab][암호문 + GCM tag]를 base64로 인코딩했다.
// 이 값이 풀리지 않으면 이미 GitHub에 저장된 잠금 노트를 열 수 없게 된다는 뜻이다.
const GOLDEN_DEFAULT_PEPPER = {
  payload: 'AgECAwQFBgcICQoLDA0ODxCgoaKjpKWmp6ipqquuwDg4UE/bF4Z6dOWsIHBZCgo4yZJozj14F9jS4ID2wmXznZnChW/hrXwwMMtcE2fCZw++2w==',
  pin: '123456',
  issueNumber: 42,
  body: '잠긴 노트 본문 🔐\nsecond line'
};
// 같은 형식이지만 pepper를 'custom-pepper'로 만든 벡터다.
const GOLDEN_CUSTOM_PEPPER = {
  payload: 'AgECAwQFBgcICQoLDA0ODxCgoaKjpKWmp6ipqqs483tI++0qK7HhTLOj+BLn1+/BDZGr45+3G12Kcy3Kw/mA',
  pin: '654321',
  issueNumber: 7,
  body: 'custom pepper body'
};

function decodePayload(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodePayload(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

// PBKDF2 60만 회라 암복호화 한 번에 수백 ms가 걸린다.
const CRYPTO_TIMEOUT = 20_000;

describe('normalizeLockPin', () => {
  it('숫자 6자리만 PIN으로 인정한다', () => {
    expect(normalizeLockPin('123456')).toBe('123456');
    expect(normalizeLockPin(123456)).toBe('123456');
    expect(normalizeLockPin('12-34 56')).toBe('123456');
    expect(normalizeLockPin('1234567')).toBe('123456');
  });

  it('6자리가 안 되거나 비어 있으면 빈 문자열을 돌려준다', () => {
    expect(normalizeLockPin('12345')).toBe('');
    expect(normalizeLockPin('abcdef')).toBe('');
    expect(normalizeLockPin('')).toBe('');
    expect(normalizeLockPin(null)).toBe('');
    expect(normalizeLockPin(undefined)).toBe('');
  });
});

describe('잠금 제목 표식', () => {
  it('제목 앞의 🔒로 잠금 여부를 판단한다', () => {
    expect(isLockedTitle('🔒 비밀')).toBe(true);
    expect(isLockedTitle('비밀 🔒')).toBe(false);
    expect(isLockedTitle('')).toBe(false);
    expect(isLockedTitle()).toBe(false);
  });

  it('표식을 한 번만 붙이고 떼어낸다', () => {
    expect(addLockToTitle('비밀')).toBe('🔒 비밀');
    expect(addLockToTitle('🔒 비밀')).toBe('🔒 비밀');
    expect(addLockToTitle('🔒비밀')).toBe('🔒 비밀');
    expect(addLockToTitle('')).toBe('🔒');
    expect(removeLockFromTitle('🔒 비밀')).toBe('비밀');
    expect(removeLockFromTitle('🔒   비밀')).toBe('비밀');
    expect(removeLockFromTitle('비밀')).toBe('비밀');
  });

  it('GitHub 제목 길이 제한(256자)을 넘지 않는다', () => {
    const locked = addLockToTitle('가'.repeat(300));
    expect(locked.length).toBe(256);
    expect(isLockedTitle(locked)).toBe(true);
  });
});

describe('isLockedPayload', () => {
  it('저장 형식(버전 2 + 헤더 + 암호문)을 알아본다', () => {
    expect(isLockedPayload(GOLDEN_DEFAULT_PEPPER.payload)).toBe(true);
  });

  it('일반 본문이나 깨진 값은 잠금 데이터로 보지 않는다', () => {
    expect(isLockedPayload('그냥 평문 노트')).toBe(false);
    expect(isLockedPayload('')).toBe(false);
    expect(isLockedPayload(null)).toBe(false);
    expect(isLockedPayload('aGVsbG8=')).toBe(false);
  });

  it('버전이 다르거나 헤더만 있는 데이터는 거부한다', () => {
    const bytes = decodePayload(GOLDEN_DEFAULT_PEPPER.payload);
    const otherVersion = bytes.slice();
    otherVersion[0] = 1;
    expect(isLockedPayload(encodePayload(otherVersion))).toBe(false);
    expect(isLockedPayload(encodePayload(bytes.slice(0, 29)))).toBe(false);
  });
});

describe('잠금 본문 암복호화', () => {
  it('기존 저장 형식의 고정 벡터를 복호화한다', async () => {
    const { payload, pin, issueNumber, body } = GOLDEN_DEFAULT_PEPPER;
    await expect(decryptLockedBody(payload, pin, issueNumber)).resolves.toBe(body);
    // PIN과 이슈 번호는 숫자·문자열 어느 쪽으로 넘겨도 같은 키가 나와야 한다.
    await expect(decryptLockedBody(payload, Number(pin), String(issueNumber))).resolves.toBe(body);
  }, CRYPTO_TIMEOUT);

  it('암호화한 본문을 같은 PIN과 이슈 번호로 되돌린다', async () => {
    const body = '여러 줄\n본문 ✅ emoji\n' + 'x'.repeat(70_000);
    const payload = await encryptLockedBody(body, '000123', 9);
    expect(isLockedPayload(payload)).toBe(true);
    expect(payload).not.toContain('여러 줄');
    await expect(decryptLockedBody(payload, '000123', 9)).resolves.toBe(body);
  }, CRYPTO_TIMEOUT);

  it('빈 본문도 암복호화한다', async () => {
    const payload = await encryptLockedBody('', '111111', 1);
    await expect(decryptLockedBody(payload, '111111', 1)).resolves.toBe('');
  }, CRYPTO_TIMEOUT);

  it('매번 새 salt와 iv를 써서 같은 본문도 다른 암호문이 된다', async () => {
    const first = await encryptLockedBody('같은 본문', '123456', 3);
    const second = await encryptLockedBody('같은 본문', '123456', 3);
    expect(first).not.toBe(second);
    const [firstBytes, secondBytes] = [decodePayload(first), decodePayload(second)];
    expect(firstBytes[0]).toBe(2);
    expect(firstBytes.slice(1, 17)).not.toEqual(secondBytes.slice(1, 17));
    expect(firstBytes.slice(17, 29)).not.toEqual(secondBytes.slice(17, 29));
  }, CRYPTO_TIMEOUT);

  it('PIN이 틀리면 복호화하지 않는다', async () => {
    const { payload, issueNumber } = GOLDEN_DEFAULT_PEPPER;
    await expect(decryptLockedBody(payload, '654321', issueNumber)).rejects.toThrow('6자리 숫자가 맞지 않거나');
  }, CRYPTO_TIMEOUT);

  it('다른 이슈로 옮겨진 암호문은 같은 PIN으로도 열리지 않는다', async () => {
    const { payload, pin } = GOLDEN_DEFAULT_PEPPER;
    await expect(decryptLockedBody(payload, pin, 43)).rejects.toThrow('6자리 숫자가 맞지 않거나');
  }, CRYPTO_TIMEOUT);

  it('암호문이 한 바이트라도 바뀌면 GCM 인증에서 거부한다', async () => {
    const { payload, pin, issueNumber } = GOLDEN_DEFAULT_PEPPER;
    const bytes = decodePayload(payload);
    bytes[bytes.length - 1] ^= 0x01;
    await expect(decryptLockedBody(encodePayload(bytes), pin, issueNumber)).rejects.toThrow('6자리 숫자가 맞지 않거나');
  }, CRYPTO_TIMEOUT);

  it('형식이 깨졌거나 지원하지 않는 데이터는 키 유도 전에 거부한다', async () => {
    await expect(decryptLockedBody('%%%not-base64%%%', '123456', 1)).rejects.toThrow('잠금 데이터 형식을 읽을 수 없습니다.');
    await expect(decryptLockedBody('그냥 평문', '123456', 1)).rejects.toThrow('잠금 데이터 형식을 읽을 수 없습니다.');
    await expect(decryptLockedBody('aGVsbG8=', '123456', 1)).rejects.toThrow('지원하지 않는 잠금 데이터입니다.');
    const bytes = decodePayload(GOLDEN_DEFAULT_PEPPER.payload);
    bytes[0] = 1;
    await expect(decryptLockedBody(encodePayload(bytes), '123456', 42)).rejects.toThrow('지원하지 않는 잠금 데이터입니다.');
  });

  it('PIN이나 이슈 번호가 잘못되면 암복호화 모두 거부한다', async () => {
    const { payload } = GOLDEN_DEFAULT_PEPPER;
    for (const pin of ['12345', '', null, 'abcdef']) {
      await expect(encryptLockedBody('본문', pin, 1)).rejects.toThrow('6자리 숫자를 입력해 주세요.');
      await expect(decryptLockedBody(payload, pin, 42)).rejects.toThrow('6자리 숫자를 입력해 주세요.');
    }
    for (const issueNumber of [0, -1, 1.5, 'abc', null, undefined]) {
      await expect(encryptLockedBody('본문', '123456', issueNumber)).rejects.toThrow('이슈 번호가 필요합니다.');
      await expect(decryptLockedBody(payload, '123456', issueNumber)).rejects.toThrow('이슈 번호가 필요합니다.');
    }
  });
});

describe('VITE_NOTE_LOCK_PEPPER로 pepper를 바꾼 배포', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function importWithPepper(pepper) {
    vi.stubEnv('VITE_NOTE_LOCK_PEPPER', pepper);
    vi.resetModules();
    return import('./note-lock.js');
  }

  it('설정한 pepper로 잠근 노트를 연다', async () => {
    const lock = await importWithPepper('custom-pepper');
    const { payload, pin, issueNumber, body } = GOLDEN_CUSTOM_PEPPER;
    await expect(lock.decryptLockedBody(payload, pin, issueNumber)).resolves.toBe(body);
  }, CRYPTO_TIMEOUT);

  it('pepper를 바꾸기 전 기본 pepper로 잠근 노트도 계속 연다', async () => {
    const lock = await importWithPepper('custom-pepper');
    const { payload, pin, issueNumber, body } = GOLDEN_DEFAULT_PEPPER;
    await expect(lock.decryptLockedBody(payload, pin, issueNumber)).resolves.toBe(body);
  }, CRYPTO_TIMEOUT);

  it('새로 잠그는 노트는 설정한 pepper를 쓴다', async () => {
    const lock = await importWithPepper('custom-pepper');
    const payload = await lock.encryptLockedBody('새 본문', '222222', 5);
    await expect(lock.decryptLockedBody(payload, '222222', 5)).resolves.toBe('새 본문');
    // 기본 pepper만 아는 빌드에서는 열리지 않아야 설정한 pepper가 실제로 쓰였다는 뜻이다.
    await expect(decryptLockedBody(payload, '222222', 5)).rejects.toThrow('6자리 숫자가 맞지 않거나');
  }, CRYPTO_TIMEOUT);

  it('기본 빌드는 사용자 지정 pepper로 잠근 노트를 열지 못한다', async () => {
    const { payload, pin, issueNumber } = GOLDEN_CUSTOM_PEPPER;
    await expect(decryptLockedBody(payload, pin, issueNumber)).rejects.toThrow('6자리 숫자가 맞지 않거나');
  }, CRYPTO_TIMEOUT);

  it('공백뿐인 설정값은 무시하고 기본 pepper를 쓴다', async () => {
    const lock = await importWithPepper('   ');
    const payload = await lock.encryptLockedBody('본문', '333333', 6);
    await expect(decryptLockedBody(payload, '333333', 6)).resolves.toBe('본문');
  }, CRYPTO_TIMEOUT);
});
