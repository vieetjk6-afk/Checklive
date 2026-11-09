import ExcelJS from 'exceljs';
import type { OrderDTO } from './orderService.js';

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Chờ khách xác nhận',
  CONFIRMED: 'Khách đã xác nhận',
  APPROVED: 'Đã chốt',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã huỷ',
  EXPIRED: 'Hết hạn giữ hàng',
};
const ITEM_STATUS_LABEL: Record<string, string> = {
  RESERVED: 'Đã giữ hàng',
  WAITLIST: 'Chờ hàng',
  NEEDS_VARIANT: 'Chưa rõ phân loại',
  CANCELLED: 'Đã huỷ',
};
const PLATFORM_LABEL: Record<string, string> = { TIKTOK: 'TikTok', FACEBOOK: 'Facebook', SIMULATOR: 'Giả lập' };

const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');

function header(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Xuất đơn hàng của phiên: 1 trang theo đơn, 1 trang theo từng dòng sản phẩm */
export async function buildOrdersWorkbook(orders: OrderDTO[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Checklive';

  const s1 = wb.addWorksheet('Đơn hàng');
  s1.columns = [
    { header: 'Mã đơn', key: 'code', width: 10 },
    { header: 'Trạng thái', key: 'status', width: 20 },
    { header: 'Nền tảng', key: 'platform', width: 10 },
    { header: 'Tên trên live', key: 'display', width: 24 },
    { header: 'Người nhận', key: 'rname', width: 22 },
    { header: 'SĐT', key: 'rphone', width: 14 },
    { header: 'Địa chỉ', key: 'raddr', width: 40 },
    { header: 'Sản phẩm', key: 'items', width: 50 },
    { header: 'Tổng tiền', key: 'total', width: 13, style: { numFmt: '#,##0' } },
    { header: 'Thanh toán', key: 'pay', width: 14 },
    { header: 'Đã trả', key: 'paid', width: 9 },
    { header: 'Ghi chú', key: 'note', width: 30 },
    { header: 'Tạo lúc', key: 'created', width: 20 },
  ];
  for (const o of orders) {
    s1.addRow({
      code: o.code,
      status: ORDER_STATUS_LABEL[o.status] ?? o.status,
      platform: PLATFORM_LABEL[o.platform] ?? o.platform,
      display: o.displayName ?? o.handle ?? '',
      rname: o.receiverName ?? '',
      rphone: o.receiverPhone ?? '',
      raddr: o.receiverAddress ?? '',
      items: o.items
        .filter((i) => i.status !== 'CANCELLED')
        .map((i) => `${i.code}${i.variantLabel ? ` ${i.variantLabel}` : ''} x${i.quantity}${i.status === 'RESERVED' ? '' : ` (${ITEM_STATUS_LABEL[i.status]})`}`)
        .join('; '),
      total: o.total,
      pay: o.paymentMethod === 'BANK' ? 'Chuyển khoản' : 'COD',
      paid: o.paymentStatus === 'PAID' ? 'Có' : '',
      note: o.note ?? '',
      created: fmt(o.createdAt),
    });
  }
  header(s1);

  const s2 = wb.addWorksheet('Chi tiết sản phẩm');
  s2.columns = [
    { header: 'Mã đơn', key: 'code', width: 10 },
    { header: 'Trạng thái đơn', key: 'ostatus', width: 20 },
    { header: 'Mã SP', key: 'sp', width: 8 },
    { header: 'Sản phẩm', key: 'name', width: 30 },
    { header: 'Phân loại', key: 'variant', width: 18 },
    { header: 'Số lượng', key: 'qty', width: 9 },
    { header: 'Đơn giá', key: 'price', width: 12, style: { numFmt: '#,##0' } },
    { header: 'Thành tiền', key: 'amount', width: 13, style: { numFmt: '#,##0' } },
    { header: 'Trạng thái dòng', key: 'istatus', width: 18 },
    { header: 'Bình luận gốc', key: 'src', width: 40 },
  ];
  for (const o of orders) {
    for (const i of o.items) {
      s2.addRow({
        code: o.code,
        ostatus: ORDER_STATUS_LABEL[o.status] ?? o.status,
        sp: i.code,
        name: i.productName,
        variant: i.variantLabel ?? '',
        qty: i.quantity,
        price: i.unitPrice,
        amount: i.unitPrice * i.quantity,
        istatus: ITEM_STATUS_LABEL[i.status] ?? i.status,
        src: i.sourceText ?? '',
      });
    }
  }
  header(s2);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
