import { afterEach, describe, expect, it } from 'vitest';
import { DRAFTS_STORAGE_KEY, readDraftStore, renameDraftLabels, writeDraftStore } from './draft-store.js';

afterEach(() => localStorage.clear());

describe('draft-store', () => {
  it('저장한 초안을 그대로 읽는다', () => {
    writeDraftStore({ 'octo/notes': { 'note-1': { title: '제목', labels: ['work'] } } });
    expect(readDraftStore()).toEqual({ 'octo/notes': { 'note-1': { title: '제목', labels: ['work'] } } });
  });

  it('비었거나 깨진 저장소는 빈 객체로 읽는다', () => {
    expect(readDraftStore()).toEqual({});
    localStorage.setItem(DRAFTS_STORAGE_KEY, '{broken');
    expect(readDraftStore()).toEqual({});
  });

  it('해당 저장소 초안의 태그만 바꾸거나 뗀다', () => {
    writeDraftStore({
      'octo/notes': {
        a: { labels: ['Work', 'home'] },
        b: { title: '태그 없음' }
      },
      'octo/other': { c: { labels: ['work'] } }
    });

    renameDraftLabels('octo/notes', 'work', 'job');
    expect(readDraftStore()['octo/notes'].a.labels).toEqual(['job', 'home']);
    expect(readDraftStore()['octo/notes'].b).toEqual({ title: '태그 없음' });
    expect(readDraftStore()['octo/other'].c.labels).toEqual(['work']);

    renameDraftLabels('octo/notes', 'home');
    expect(readDraftStore()['octo/notes'].a.labels).toEqual(['job']);
  });

  it('초안이 없거나 저장소가 깨져 있으면 아무것도 쓰지 않는다', () => {
    renameDraftLabels('octo/notes', 'work', 'job');
    expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull();
    localStorage.setItem(DRAFTS_STORAGE_KEY, '{broken');
    expect(() => renameDraftLabels('octo/notes', 'work')).not.toThrow();
    expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBe('{broken');
  });
});
