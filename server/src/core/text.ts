/** Bỏ dấu tiếng Việt: "Đỏ Mận" -> "Do Man" */
export function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Chuẩn hoá để so khớp: bỏ dấu, chữ thường, gộp khoảng trắng. */
export function normalizeText(input: string): string {
  return stripDiacritics(input).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Đầu số di động Việt Nam hiện hành: 03, 05, 07, 08, 09
const VN_MOBILE = /^0[35789]\d{8}$/;

/**
 * Tìm số điện thoại di động Việt Nam trong bình luận.
 * Chấp nhận dạng 0912345678, 0912 345 678, 0912.345.678, +84912345678, 84 912 345 678.
 * Trả về danh sách số đã chuẩn hoá về dạng 0xxxxxxxxx.
 */
export function extractPhones(input: string): string[] {
  const found = new Set<string>();
  const candidates = input.match(/(?:\+?84|0)(?:[\s.\-]?\d){9}(?!\d)/g) ?? [];
  for (const raw of candidates) {
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('84')) digits = '0' + digits.slice(2);
    if (VN_MOBILE.test(digits)) found.add(digits);
  }
  return [...found];
}

export function hasPhone(input: string | undefined | null): boolean {
  return !!input && extractPhones(input).length > 0;
}

/** Che bớt số điện thoại: 0912345678 -> 0912***678 */
export function maskPhone(phone: string): string {
  return phone.length < 7 ? phone : `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}
