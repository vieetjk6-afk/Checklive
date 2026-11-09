import { describe, expect, it } from 'vitest';
import { buildVietQrPayload, cleanTransferNote, crc16 } from '../src/sales/vietqr.js';

describe('VietQR', () => {
  it('CRC16-CCITT đúng chuẩn', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('tạo payload đúng cấu trúc', () => {
    const p = buildVietQrPayload({ bin: '970436', accountNo: '0123456789', amount: 250000, note: 'Đơn A7K2P' });
    expect(p.startsWith('000201010212')).toBe(true);
    expect(p).toContain('0010A000000727');
    expect(p).toContain('0006970436');
    expect(p).toContain('01100123456789');
    expect(p).toContain('0208QRIBFTTA');
    expect(p).toContain('5303704');
    expect(p).toContain('5406250000');
    expect(p).toContain('5802VN');
    expect(p).toContain('62130809Don A7K2P');
    expect(p.slice(-8, -4)).toBe('6304');
    expect(crc16(p.slice(0, -4))).toBe(p.slice(-4));
  });

  it('không có số tiền thì là mã tĩnh', () => {
    expect(buildVietQrPayload({ bin: '970436', accountNo: '0123456789' }).startsWith('000201010211')).toBe(true);
  });

  it('nội dung chuyển khoản không dấu, gọn', () => {
    expect(cleanTransferNote('Thanh toán đơn #A7K2P!!')).toBe('Thanh toan don A7K2P');
  });

  it('báo lỗi khi sai BIN', () => {
    expect(() => buildVietQrPayload({ bin: '123', accountNo: '0123456789' })).toThrow();
  });
});
