import { describe, expect, it } from 'vitest';
import { extractPhones, maskPhone, normalizeText, stripDiacritics } from '../src/core/text.js';

describe('text', () => {
  it('bỏ dấu tiếng Việt', () => {
    expect(stripDiacritics('Đỏ mận Hà Nội')).toBe('Do man Ha Noi');
    expect(normalizeText('  CHỐT   A1  Đỏ ')).toBe('chot a1 do');
  });

  it('nhận diện số điện thoại di động VN ở nhiều dạng', () => {
    expect(extractPhones('0912345678 lấy A1')).toEqual(['0912345678']);
    expect(extractPhones('sdt 0912 345 678')).toEqual(['0912345678']);
    expect(extractPhones('0987.654.321 chốt A4')).toEqual(['0987654321']);
    expect(extractPhones('+84 912-345-678')).toEqual(['0912345678']);
    expect(extractPhones('84912345678')).toEqual(['0912345678']);
    expect(extractPhones('gọi 0356789012 hoặc 0912345678')).toEqual(['0356789012', '0912345678']);
  });

  it('không nhận nhầm mã sản phẩm, số lượng hay số quá dài', () => {
    expect(extractPhones('A1 2 cái')).toEqual([]);
    expect(extractPhones('0212345678')).toEqual([]); // đầu 02 là số bàn
    expect(extractPhones('091234567')).toEqual([]); // thiếu số
    expect(extractPhones('09123456789')).toEqual([]); // thừa số
  });

  it('che số điện thoại', () => {
    expect(maskPhone('0912345678')).toBe('0912***678');
  });
});
