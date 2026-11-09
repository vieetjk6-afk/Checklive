import { describe, expect, it } from 'vitest';
import { mapChat, mapGift, mapLike, mapTikTokUser, toMs } from '../src/adapters/tiktok.js';

describe('TikTok mapping', () => {
  const user = { userId: '123', uniqueId: 'lan.shop', nickname: 'Lan', profilePicture: { url: ['https://x/a.jpg'] } };

  it('người dùng', () => {
    expect(mapTikTokUser(user)).toEqual({ id: '123', name: 'Lan', handle: 'lan.shop', avatarUrl: 'https://x/a.jpg' });
    expect(mapTikTokUser(undefined)).toBeUndefined();
  });

  it('thời gian giây / mili giây', () => {
    expect(toMs('1762682400')).toBe(1762682400000);
    expect(toMs(1762682400123)).toBe(1762682400123);
    expect(toMs(undefined)).toBeUndefined();
  });

  it('bình luận và like', () => {
    expect(mapChat({ user, comment: 'A1 x2', common: { msgId: '9', createTime: '1762682400123' } })).toMatchObject({
      type: 'comment', content: 'A1 x2', externalId: '9', platformTs: 1762682400123, user: { id: '123' },
    });
    expect(mapLike({ user, likeCount: 15 })).toMatchObject({ type: 'like', count: 15 });
  });

  it('quà dạng chuỗi chỉ ghi nhận khi kết thúc chuỗi', () => {
    expect(mapGift({ user, giftDetails: { giftType: 1, diamondCount: 1, giftName: 'Hoa hồng' }, repeatCount: 5, repeatEnd: false })).toBeUndefined();
    expect(mapGift({ user, giftDetails: { giftType: 1, diamondCount: 1, giftName: 'Hoa hồng' }, repeatCount: 5, repeatEnd: true }))
      .toMatchObject({ type: 'gift', count: 5, value: 5, content: 'Hoa hồng' });
    expect(mapGift({ user, giftDetails: { giftType: 2, diamondCount: 99, giftName: 'Mũ' }, repeatCount: 1 }))
      .toMatchObject({ count: 1, value: 99 });
  });
});
