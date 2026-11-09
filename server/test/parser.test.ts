import { describe, expect, it } from 'vitest';
import { isQuestion, normalizeCode, parseOrderComment, tokenize, type ParserConfig, type ParserProduct } from '../src/sales/parser.js';

// A1: áo 3 màu x 3 size ; A2: quần không phân loại ; A3: giày size số ; B10: đang đóng
const ao: ParserProduct = {
  id: 'sp-a1', code: 'A1', status: 'SELLING', openedAt: 100,
  variants: ['Đỏ', 'Xanh than', 'Trắng'].flatMap((mau) =>
    ['S', 'M', 'L'].map((size) => ({ id: `a1-${mau}-${size}`, options: { 'Màu': mau, Size: size } })),
  ),
};
const quan: ParserProduct = { id: 'sp-a2', code: 'A2', status: 'WAITING', variants: [{ id: 'a2', options: {} }] };
const giay: ParserProduct = {
  id: 'sp-a3', code: 'a3', status: 'SELLING', openedAt: 50,
  variants: ['38', '39', '40'].map((s) => ({ id: `a3-${s}`, options: { Size: s } })),
};
const dong: ParserProduct = { id: 'sp-b10', code: 'B10', status: 'CLOSED', variants: [{ id: 'b10', options: {} }] };
const ALL = [ao, quan, giay, dong];
const cfg: ParserConfig = { mode: 'ALL_CODES', keywords: ['chot', '+1', 'lay'] };

const parse = (text: string, c: ParserConfig = cfg) => parseOrderComment(text, ALL, c);
const one = (text: string) => {
  const r = parse(text);
  expect(r.lines).toHaveLength(1);
  return r.lines[0];
};

describe('tokenize', () => {
  it('bỏ dấu, tách dấu câu và +, bỏ số điện thoại', () => {
    expect(tokenize('Chốt A1, đỏ!')).toEqual(['chot', 'a1', 'do']);
    expect(tokenize('A1+A3')).toEqual(['a1', 'a3']);
    expect(tokenize('+1 nha')).toEqual(['+1', 'nha']);
    expect(tokenize('0912.345.678 lấy A2')).toEqual(['lay', 'a2']);
    expect(tokenize('#a1')).toEqual(['a1']);
  });
  it('chuẩn hoá mã', () => {
    expect(normalizeCode(' #A 1 ')).toBe('a1');
  });
});

describe('nhận diện câu hỏi', () => {
  for (const q of ['A1 còn không?', 'A1 còn size M ko', 'giá bao nhiêu shop', 'xin giá A2', 'A1 đỏ còn hong', 'a2 mặc thế nào', 'A1 có M không ạ', 'A3 39 còn hàng'])
    it(`"${q}" là câu hỏi`, () => expect(isQuestion(q)).toBe(true));
  for (const s of ['A1', 'chốt A1 đỏ M', 'lấy 2 cái A2', '+1', 'A1 x2 nha shop'])
    it(`"${s}" không phải câu hỏi`, () => expect(isQuestion(s)).toBe(false));
  it('câu hỏi có mã thì KHÔNG tạo đơn', () => {
    const r = parse('A1 đỏ M còn không shop?');
    expect(r.isQuestion).toBe(true);
    expect(r.lines).toEqual([]);
  });
});

describe('đọc mã, phân loại, số lượng', () => {
  it('chỉ có mã', () => {
    expect(one('A1')).toMatchObject({ sessionProductId: 'sp-a1', quantity: 1, variantId: undefined });
    expect(one('A1').candidateVariantIds).toHaveLength(9);
    expect(one('a2')).toMatchObject({ sessionProductId: 'sp-a2', quantity: 1, variantId: 'a2', candidateVariantIds: [] });
  });

  it('mã + màu + size (có dấu / không dấu / viết hoa)', () => {
    expect(one('A1 đỏ M').variantId).toBe('a1-Đỏ-M');
    expect(one('a1 do m').variantId).toBe('a1-Đỏ-M');
    expect(one('A1 size L màu trắng').variantId).toBe('a1-Trắng-L');
    expect(one('A1 xanh than S').variantId).toBe('a1-Xanh than-S');
  });

  it('chỉ có màu -> chưa rõ size, liệt kê các phân loại có thể', () => {
    const l = one('A1 đỏ');
    expect(l.variantId).toBeUndefined();
    expect(l.candidateVariantIds).toEqual(['a1-Đỏ-S', 'a1-Đỏ-M', 'a1-Đỏ-L']);
  });

  it('các kiểu ghi số lượng', () => {
    expect(one('A2 2').quantity).toBe(2);
    expect(one('A2 x3').quantity).toBe(3);
    expect(one('A2x3').quantity).toBe(3);
    expect(one('A2 x 4').quantity).toBe(4);
    expect(one('A2 *2').quantity).toBe(2);
    expect(one('lấy 2 cái A2').quantity).toBe(2); // số lượng đứng trước mã
    expect(one('2 A2').quantity).toBe(2);
    expect(one('đỏ M A1')).toMatchObject({ variantId: 'a1-Đỏ-M' });
    expect(one('A2 2 cái').quantity).toBe(2);
    expect(one('A2 2c').quantity).toBe(2);
    expect(one('A2 sl 5').quantity).toBe(5);
    expect(one('A2 số lượng 6').quantity).toBe(6);
    expect(one('A1 đỏ M 2').quantity).toBe(2);
    expect(one('A2 150').quantity).toBe(1); // số quá lớn không coi là số lượng
  });

  it('size dạng số không bị nhầm thành số lượng', () => {
    expect(one('A3 39')).toMatchObject({ variantId: 'a3-39', quantity: 1 });
    expect(one('A3 39 2')).toMatchObject({ variantId: 'a3-39', quantity: 2 });
    expect(one('A3 size 40 x2')).toMatchObject({ variantId: 'a3-40', quantity: 2 });
  });

  it('nhiều sản phẩm trong 1 bình luận', () => {
    const r = parse('A1 đỏ M, A2 2 cái + A3 38');
    expect(r.lines.map((l) => [l.sessionProductId, l.variantId, l.quantity])).toEqual([
      ['sp-a1', 'a1-Đỏ-M', 1],
      ['sp-a2', 'a2', 2],
      ['sp-a3', 'a3-38', 1],
    ]);
  });

  it('gộp dòng trùng', () => {
    const r = parse('A2 A2');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].quantity).toBe(2);
  });

  it('bình luận có số điện thoại', () => {
    const r = parse('0912 345 678 lấy A2');
    expect(r.phones).toEqual(['0912345678']);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ sessionProductId: 'sp-a2', quantity: 1 });
  });

  it('mã đã đóng bị bỏ qua và báo lại', () => {
    const r = parse('B10 2');
    expect(r.lines).toEqual([]);
    expect(r.ignoredCodes).toEqual(['B10']);
  });

  it('chế độ chỉ nhận sản phẩm đang bán', () => {
    const r = parse('A2', { ...cfg, mode: 'SELLING_ONLY' });
    expect(r.lines).toEqual([]);
    expect(r.ignoredCodes).toEqual(['A2']);
    expect(parse('A1 đỏ M', { ...cfg, mode: 'SELLING_ONLY' }).lines).toHaveLength(1);
  });

  it('mã không có trong phiên: báo lại, không tự gán cho sản phẩm đang bán', () => {
    const r = parse('0987.654.321 chốt A4');
    expect(r.lines).toEqual([]);
    expect(r.unknownCodes).toEqual(['A4']);
    const r2 = parse('A1 đỏ M, A9 2');
    expect(r2.lines).toHaveLength(1);
    expect(r2.unknownCodes).toEqual(['A9']);
    // "xl", "2xl", "x2" không phải mã
    expect(parse('chốt đỏ M x2').unknownCodes).toEqual([]);
  });

  it('không có mã nào hợp lệ thì không tạo đơn', () => {
    expect(parse('đẹp quá shop ơi').lines).toEqual([]);
    expect(parse('C9 2').lines).toEqual([]);
    expect(parse('').lines).toEqual([]);
  });
});

describe('từ khoá chốt cho sản phẩm đang bán', () => {
  it('"chốt" / "+1" / "lấy" gán cho sản phẩm mở bán gần nhất', () => {
    expect(one('chốt')).toMatchObject({ sessionProductId: 'sp-a1', viaKeyword: true });
    expect(one('+1')).toMatchObject({ sessionProductId: 'sp-a1', quantity: 1 });
    expect(one('Chốt đỏ M 2')).toMatchObject({ sessionProductId: 'sp-a1', variantId: 'a1-Đỏ-M', quantity: 2 });
    expect(one('lấy 1 trắng L')).toMatchObject({ variantId: 'a1-Trắng-L', quantity: 1 });
  });

  it('có mã thì ưu tiên mã', () => {
    expect(one('chốt A2')).toMatchObject({ sessionProductId: 'sp-a2', viaKeyword: false });
  });

  it('không có sản phẩm đang bán thì bỏ qua', () => {
    const none = ALL.map((p) => ({ ...p, status: p.status === 'SELLING' ? ('WAITING' as const) : p.status }));
    expect(parseOrderComment('chốt', none, cfg).lines).toEqual([]);
  });

  it('từ khoá tuỳ chỉnh', () => {
    expect(parse('em lấy', { ...cfg, keywords: ['mua'] }).lines).toEqual([]);
    expect(parse('mua nha', { ...cfg, keywords: ['mua'] }).lines).toHaveLength(1);
  });
});
