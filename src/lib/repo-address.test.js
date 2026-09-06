import { describe, expect, it } from 'vitest';
import { makePatCreationUrl, normalizeToken, parseRepositoryAddress } from './repo-address.js';

describe('parseRepositoryAddress', () => {
  it('owner/repo 형태를 owner, name, fullName으로 분리한다', () => {
    expect(parseRepositoryAddress('zidell/ginote')).toEqual({
      owner: 'zidell',
      name: 'ginote',
      fullName: 'zidell/ginote'
    });
  });

  it('GitHub URL과 .git 접미사, 앞뒤 슬래시를 정리한다', () => {
    expect(parseRepositoryAddress('https://github.com/zidell/ginote.git')).toEqual({
      owner: 'zidell',
      name: 'ginote',
      fullName: 'zidell/ginote'
    });
    expect(parseRepositoryAddress('/zidell/ginote/')).toEqual({
      owner: 'zidell',
      name: 'ginote',
      fullName: 'zidell/ginote'
    });
  });

  it('슬래시가 없거나 공백을 포함하거나 세그먼트가 비어 있으면 null을 반환한다', () => {
    expect(parseRepositoryAddress('ginote')).toBeNull();
    expect(parseRepositoryAddress('owner name/repo')).toBeNull();
    expect(parseRepositoryAddress('owner//repo')).toBeNull();
    expect(parseRepositoryAddress('')).toBeNull();
  });
});

describe('normalizeToken', () => {
  it('앞뒤 공백과 폭 없는 유니코드 문자를 제거한다', () => {
    expect(normalizeToken('  github_pat_abc123  ')).toBe('github_pat_abc123');
    expect(normalizeToken('github_pat_​abc123﻿')).toBe('github_pat_abc123');
  });
});

describe('makePatCreationUrl', () => {
  it('저장소가 지정되면 이름/설명/타깃을 채운 URL을 만든다', () => {
    const url = new URL(makePatCreationUrl('zidell/ginote'));
    expect(url.searchParams.get('name')).toBe('Ginote - ginote');
    expect(url.searchParams.get('target_name')).toBe('zidell');
    expect(url.searchParams.get('issues')).toBe('write');
  });

  it('저장소가 없으면 기본 이름/설명으로 URL을 만든다', () => {
    const url = new URL(makePatCreationUrl(''));
    expect(url.searchParams.get('name')).toBe('Ginote');
    expect(url.searchParams.has('target_name')).toBe(false);
  });
});
