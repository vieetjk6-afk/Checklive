import { stripDiacritics } from '../core/text.js';

/**
 * Tạo nội dung mã VietQR (chuẩn EMVCo / NAPAS) để khách quét bằng app ngân hàng.
 * Tạo ngay trên server, không gọi dịch vụ bên ngoài.
 */

function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC16-CCITT (poly 0x1021, khởi tạo 0xFFFF) */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Nội dung chuyển khoản: không dấu, chỉ chữ/số/khoảng trắng, tối đa 25 ký tự */
export function cleanTransferNote(note: string): string {
  return stripDiacritics(note).replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25);
}

export interface VietQrInput {
  /** Mã BIN ngân hàng (6 số), VD Vietcombank 970436 */
  bin: string;
  accountNo: string;
  amount?: number;
  note?: string;
}

export function buildVietQrPayload({ bin, accountNo, amount, note }: VietQrInput): string {
  if (!/^\d{6}$/.test(bin)) throw new Error('Mã BIN ngân hàng phải gồm 6 chữ số');
  if (!/^[0-9A-Za-z]{4,19}$/.test(accountNo)) throw new Error('Số tài khoản không hợp lệ');
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', accountNo)) + tlv('02', 'QRIBFTTA');
  let s = tlv('00', '01') + tlv('01', amount ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
  if (amount && amount > 0) s += tlv('54', String(Math.round(amount)));
  s += tlv('58', 'VN');
  const cleaned = note ? cleanTransferNote(note) : '';
  if (cleaned) s += tlv('62', tlv('08', cleaned));
  s += '6304';
  return s + crc16(s);
}
