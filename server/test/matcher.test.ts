import { describe, expect, it } from 'vitest';
import { boardOf, letterIndices, looksLikeNonAnswer, matchesAnswer, normalizeAnswer, parseGuessNumber, pickRevealIndex } from '../src/games/matcher.js';

describe('so khớp đáp án', () => {
  it('chuẩn hoá', () => {
    expect(normalizeAnswer('  Con MÈO!! ')).toBe('con meo');
    expect(normalizeAnswer('Con MÈO', false)).toBe('con mèo');
  });

  it('chấp nhận nhiều cách ghi', () => {
    const ans = ['Con mèo'];
    for (const c of ['con mèo', 'CON MEO', 'conmeo', 'đáp án là con mèo ạ', 'con mèo!!!', 'Con  Mèo']) expect(matchesAnswer(c, ans)).toBe(true);
    for (const c of ['con chó', 'mèo', 'con mèoo', 'concon mèo', '']) expect(matchesAnswer(c, ans)).toBe(false);
  });

  it('phân biệt dấu khi bật chế độ có dấu', () => {
    expect(matchesAnswer('con meo', ['con mèo'], false)).toBe(false);
    expect(matchesAnswer('con mèo', ['con mèo'], false)).toBe(true);
  });

  it('nhiều đáp án được chấp nhận', () => {
    expect(matchesAnswer('hà nội', ['Hà Nội', 'Ha Noi', 'HN'])).toBe(true);
    expect(matchesAnswer('hn', ['Hà Nội', 'HN'])).toBe(true);
  });
});

describe('đọc số đoán', () => {
  it('số đầu tiên trong khoảng', () => {
    expect(parseGuessNumber('37', 1, 100)).toBe(37);
    expect(parseGuessNumber('em đoán số 07 nha', 1, 100)).toBe(7);
    expect(parseGuessNumber('#88', 1, 100)).toBe(88);
    expect(parseGuessNumber('150 hay 42', 1, 100)).toBe(42);
  });
  it('không lấy số dính chữ, số điện thoại, số ngoài khoảng', () => {
    expect(parseGuessNumber('A1 đỏ', 1, 100)).toBeUndefined();
    expect(parseGuessNumber('0912345678', 0, 99999)).toBeUndefined();
    expect(parseGuessNumber('101', 1, 100)).toBeUndefined();
    expect(parseGuessNumber('hay quá', 1, 100)).toBeUndefined();
  });
});

describe('ô chữ', () => {
  it('chỉ lộ chữ đã mở, giữ khoảng trắng', () => {
    expect(letterIndices('Con mèo')).toEqual([0, 1, 2, 4, 5, 6]);
    const b = boardOf('Con mèo', [0, 5]);
    expect(b.map((c) => (c.space ? ' ' : c.ch ?? '_')).join('')).toBe('C__ _È_');
    expect(boardOf('Con mèo', [], true).map((c) => c.ch ?? ' ').join('')).toBe('CON MÈO');
  });
  it('mở ngẫu nhiên chữ chưa mở', () => {
    expect(pickRevealIndex('ab', [0], () => 0)).toBe(1);
    expect(pickRevealIndex('ab', [0, 1])).toBeUndefined();
  });
});

describe('bình luận không phải câu trả lời (không mất lượt)', () => {
  it('bỏ qua hỏi hàng, chốt đơn, SĐT, số', () => {
    const ans = ['Áo dài'];
    for (const c of ['A1', 'A3 x2', 'size M còn không', '0987.654.321 chốt A4', 'giá bao nhiêu shop?', '80', 'em đoán 39 ?', ''])
      expect(looksLikeNonAnswer(c, ans)).toBe(true);
  });
  it('vẫn tính đoán sai bình thường', () => {
    for (const c of ['nón lá', 'áo bà ba', 'hay quá', 'con mèo']) expect(looksLikeNonAnswer(c, ['Áo dài'])).toBe(false);
  });
  it('đáp án có số / có mã thì không bỏ qua số / mã', () => {
    expect(looksLikeNonAnswer('1975', ['1975'])).toBe(false);
    expect(looksLikeNonAnswer('2024', ['1975'])).toBe(false);
    expect(looksLikeNonAnswer('iphone 15', ['iPhone 15'])).toBe(false);
    expect(looksLikeNonAnswer('a7', ['Galaxy A7'])).toBe(false);
  });
});
