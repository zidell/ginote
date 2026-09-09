import { describe, expect, it } from 'vitest';
import {
  PIN_LABEL_NAME,
  hasPinLabel,
  isPinLabel,
  withPinState,
  visibleLabelNames,
  visibleLabels
} from './pin-label.js';

describe('pin label', () => {
  it('예약 라벨을 대소문자와 무관하게 판별한다', () => {
    expect(PIN_LABEL_NAME).toBe('ginote:pin');
    expect(isPinLabel('ginote:pin')).toBe(true);
    expect(isPinLabel({ name: 'GINOTE:PIN' })).toBe(true);
    expect(isPinLabel('pin')).toBe(false);
  });

  it('이슈의 예약 라벨 포함 여부를 확인한다', () => {
    expect(hasPinLabel({ labels: [{ name: 'work' }, { name: 'ginote:pin' }] })).toBe(true);
    expect(hasPinLabel({ labels: [{ name: 'work' }] })).toBe(false);
  });

  it('핀 상태를 바꿀 때 다른 라벨은 보존하고 예약 라벨은 하나만 둔다', () => {
    const issue = { id: 1, labels: [{ name: 'work' }, { name: 'GINOTE:PIN' }] };

    expect(withPinState(issue, false)).toEqual({
      id: 1,
      labels: [{ name: 'work' }]
    });
    expect(withPinState(issue, true)).toEqual({
      id: 1,
      labels: [{ name: 'work' }, { name: PIN_LABEL_NAME }]
    });
  });

  it('화면에 보여줄 라벨에서 예약 라벨을 제외한다', () => {
    expect(visibleLabels([{ name: 'work' }, { name: 'ginote:pin' }])).toEqual([{ name: 'work' }]);
    expect(visibleLabelNames(['work', 'ginote:pin'])).toEqual(['work']);
  });
});
