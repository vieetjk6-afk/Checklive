/** Bỏ dấu + chữ thường để tìm kiếm tiếng Việt không dấu */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

const PHONE_RE = /(?:\+?84|0)(?:[\s.\-]?\d){9}(?!\d)/g;

/** Tách nội dung thành các đoạn, đánh dấu đoạn là số điện thoại (khớp với danh sách server đã nhận diện) */
export function splitPhones(content: string, phones: string[]): { text: string; phone: boolean }[] {
  if (phones.length === 0) return [{ text: content, phone: false }];
  const out: { text: string; phone: boolean }[] = [];
  let last = 0;
  for (const m of content.matchAll(PHONE_RE)) {
    let digits = m[0].replace(/\D/g, '');
    if (digits.startsWith('84')) digits = '0' + digits.slice(2);
    if (!phones.includes(digits)) continue;
    const i = m.index ?? 0;
    if (i > last) out.push({ text: content.slice(last, i), phone: false });
    out.push({ text: m[0], phone: true });
    last = i + m[0].length;
  }
  if (last < content.length) out.push({ text: content.slice(last), phone: false });
  return out;
}
