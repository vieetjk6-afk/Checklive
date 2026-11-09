import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { ITEM_STATUS, ORDER_STATUS, fmtCountdown, fmtDateTime, vnd } from '../../lib/format';
import { norm } from '../../lib/text';
import type { Order, OrderItem, OrderStatus, SessionProduct } from '../../lib/types';
import Modal from '../Modal';
import Qr from '../Qr';
import { Empty, PlatformBadge } from '../ui';

const FILTERS: { key: OrderStatus | 'ALL' | 'ATTENTION'; label: string }[] = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'ATTENTION', label: 'Cần xử lý' },
  { key: 'PENDING', label: 'Chờ xác nhận' },
  { key: 'CONFIRMED', label: 'Khách đã xác nhận' },
  { key: 'APPROVED', label: 'Đã chốt' },
  { key: 'COMPLETED', label: 'Hoàn tất' },
  { key: 'CANCELLED', label: 'Huỷ / hết hạn' },
];

const needsAttention = (o: Order) =>
  (o.status === 'PENDING' || o.status === 'CONFIRMED') &&
  (o.status === 'CONFIRMED' || o.items.some((i) => i.status === 'NEEDS_VARIANT'));

export function confirmLink(o: Order) {
  return `${window.location.origin}/o/${o.confirmToken}`;
}

function itemsSummary(o: Order) {
  return o.items
    .filter((i) => i.status !== 'CANCELLED')
    .map((i) => `${i.code}${i.variantLabel ? ` ${i.variantLabel}` : ''} ×${i.quantity}`)
    .join(', ');
}

function ItemRow({ order, item, products, editable }: { order: Order; item: OrderItem; products: SessionProduct[]; editable: boolean }) {
  const sp = products.find((p) => p.id === item.sessionProductId);
  const variants = sp?.product.variants ?? [];
  const run = async (body: unknown) => {
    try {
      await api(`/api/orders/${order.id}/items/${item.id}`, { method: 'PATCH', body });
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const cancelled = item.status === 'CANCELLED';
  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-slate-100 py-2 text-sm first:border-t-0">
      <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-bold text-indigo-700">{item.code}</span>
      <div className={`min-w-0 flex-1 ${cancelled ? 'text-slate-400 line-through' : ''}`}>
        <div className="truncate">{item.productName}</div>
        <div className="text-xs text-slate-500">
          {item.variantLabel ? `${item.variantLabel} · ` : ''}
          {vnd(item.unitPrice)}
          {item.sourceText && <span className="ml-1 italic text-slate-400">“{item.sourceText}”</span>}
        </div>
      </div>
      <span className={`text-xs font-medium ${ITEM_STATUS[item.status].cls}`}>{ITEM_STATUS[item.status].label}</span>
      {editable && !cancelled && variants.length > 1 && (
        <select
          className="input w-36 py-1 text-xs"
          value={item.status === 'NEEDS_VARIANT' ? '' : item.variantId ?? ''}
          onChange={(e) => e.target.value && run({ variantId: e.target.value })}
          aria-label="Chọn phân loại"
        >
          <option value="">— Chọn phân loại —</option>
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} (còn {v.available})
            </option>
          ))}
        </select>
      )}
      {editable && !cancelled ? (
        <input
          className="input w-14 py-1 text-center"
          type="number"
          min={0}
          max={99}
          defaultValue={item.quantity}
          onBlur={(e) => Number(e.target.value) !== item.quantity && run({ quantity: Number(e.target.value) })}
          aria-label="Số lượng"
        />
      ) : (
        <span className="w-10 text-right tabular-nums">×{item.quantity}</span>
      )}
    </li>
  );
}

function OrderDetail({ order, products, onClose }: { order: Order; products: SessionProduct[]; onClose: () => void }) {
  const [form, setForm] = useState({
    receiverName: order.receiverName ?? order.customer?.name ?? '',
    receiverPhone: order.receiverPhone ?? order.customer?.phone ?? '',
    receiverAddress: order.receiverAddress ?? order.customer?.address ?? '',
    note: order.note ?? '',
    paymentMethod: order.paymentMethod,
  });
  const [msg, setMsg] = useState('');
  const active = ['PENDING', 'CONFIRMED', 'APPROVED'].includes(order.status);
  const link = confirmLink(order);
  const message = `Shop đã nhận đơn ${order.code}: ${itemsSummary(order)}. Tổng ${vnd(order.total)}. Bạn xác nhận địa chỉ nhận hàng tại: ${link}`;

  const act = async (action: 'approve' | 'cancel' | 'complete') => {
    if (action === 'cancel' && !confirm('Huỷ đơn này? Hàng đang giữ sẽ chuyển cho người chờ.')) return;
    try {
      await api(`/api/orders/${order.id}/${action}`, { method: 'POST', body: action === 'cancel' ? { reason: 'Shop huỷ' } : undefined });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const save = async () => {
    setMsg('');
    try {
      await api(`/api/orders/${order.id}`, {
        method: 'PATCH',
        body: {
          receiverName: form.receiverName || null,
          receiverPhone: form.receiverPhone || null,
          receiverAddress: form.receiverAddress || null,
          note: form.note || null,
          paymentMethod: form.paymentMethod,
        },
      });
      setMsg('Đã lưu');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const togglePaid = () =>
    api(`/api/orders/${order.id}`, { method: 'PATCH', body: { paymentStatus: order.paymentStatus === 'PAID' ? 'UNPAID' : 'PAID' } }).catch((e) => alert(e.message));

  const toggleBlacklist = async () => {
    if (!order.customer) return;
    await api(`/api/customers/${order.customer.id}`, { method: 'PATCH', body: { blacklisted: !order.customer.blacklisted } }).catch((e) => alert(e.message));
    alert(order.customer.blacklisted ? 'Đã bỏ cảnh báo khách này' : 'Đã đánh dấu khách cần cảnh báo (bom hàng)');
  };

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          Đơn <span className="font-mono">{order.code}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS[order.status].cls}`}>{ORDER_STATUS[order.status].label}</span>
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <PlatformBadge platform={order.platform} />
          <span className="font-medium">{order.displayName ?? order.handle}</span>
          {order.handle && <span className="text-slate-400">@{order.handle}</span>}
          {order.customer?.blacklisted && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">Cảnh báo bom hàng</span>}
        </div>
        <div className="text-xs text-slate-500">
          Tạo {fmtDateTime(order.createdAt)}
          {order.holdUntil && order.status === 'PENDING' && ` · Giữ hàng ${fmtCountdown(order.holdUntil)}`}
          {order.cancelReason && ` · Lý do: ${order.cancelReason}`}
        </div>

        <div>
          <h4 className="mb-1 text-sm font-semibold">Sản phẩm</h4>
          <ul>
            {order.items.map((i) => (
              <ItemRow key={`${i.id}-${i.quantity}-${i.status}`} order={order} item={i} products={products} editable={active} />
            ))}
          </ul>
          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold">
            <span>Tổng</span>
            <span>{vnd(order.total)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Giao hàng & thanh toán</h4>
          <input className="input" placeholder="Tên người nhận" value={form.receiverName} onChange={(e) => setForm({ ...form, receiverName: e.target.value })} disabled={!active} />
          <input className="input" placeholder="Số điện thoại" value={form.receiverPhone} onChange={(e) => setForm({ ...form, receiverPhone: e.target.value })} disabled={!active} />
          <textarea className="input" rows={2} placeholder="Địa chỉ" value={form.receiverAddress} onChange={(e) => setForm({ ...form, receiverAddress: e.target.value })} disabled={!active} />
          <input className="input" placeholder="Ghi chú" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} disabled={!active} />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5"><input type="radio" checked={form.paymentMethod === 'COD'} onChange={() => setForm({ ...form, paymentMethod: 'COD' })} disabled={!active} /> COD</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={form.paymentMethod === 'BANK'} onChange={() => setForm({ ...form, paymentMethod: 'BANK' })} disabled={!active} /> Chuyển khoản</label>
            <button className={`btn px-2 py-1 text-xs ${order.paymentStatus === 'PAID' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white'}`} onClick={togglePaid}>
              {order.paymentStatus === 'PAID' ? '✓ Đã thanh toán' : 'Đánh dấu đã thanh toán'}
            </button>
          </div>
          {active && (
            <div className="flex items-center gap-2">
              <button className="btn-ghost" onClick={save}>Lưu thông tin</button>
              {msg && <span className="text-xs text-slate-500">{msg}</span>}
            </div>
          )}
        </div>

        {(order.status === 'PENDING' || order.status === 'CONFIRMED') && (
          <div className="rounded-xl border border-slate-200 p-3">
            <h4 className="mb-2 text-sm font-semibold">Gửi khách tự xác nhận</h4>
            <div className="flex gap-3">
              <Qr value={link} size={100} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-all text-xs text-slate-500">{link}</p>
                <div className="flex flex-wrap gap-1">
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => navigator.clipboard?.writeText(link)}>Sao chép link</button>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => navigator.clipboard?.writeText(message)}>Sao chép tin nhắn</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
          {(order.status === 'PENDING' || order.status === 'CONFIRMED') && (
            <button className="btn-primary" onClick={() => act('approve')}>✓ Chốt đơn</button>
          )}
          {order.status === 'APPROVED' && <button className="btn-primary" onClick={() => act('complete')}>Đã giao xong</button>}
          {active && <button className="btn-ghost text-rose-600" onClick={() => act('cancel')}>Huỷ đơn</button>}
          {order.customer && (
            <button className="btn-ghost ml-auto text-xs" onClick={toggleBlacklist}>
              {order.customer.blacklisted ? 'Bỏ cảnh báo khách' : 'Đánh dấu bom hàng'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function OrdersTab({ sessionId, orders, products }: { sessionId: string; orders: Order[]; products: SessionProduct[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('ALL');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: orders.length, ATTENTION: orders.filter(needsAttention).length };
    for (const o of orders) {
      const k = o.status === 'EXPIRED' ? 'CANCELLED' : o.status;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [orders]);

  const revenue = orders.filter((o) => ['PENDING', 'CONFIRMED', 'APPROVED', 'COMPLETED'].includes(o.status)).reduce((s, o) => s + o.total, 0);
  const approvedRevenue = orders.filter((o) => o.status === 'APPROVED' || o.status === 'COMPLETED').reduce((s, o) => s + o.total, 0);

  const q = norm(search.trim());
  const list = orders.filter((o) => {
    if (filter === 'ATTENTION' && !needsAttention(o)) return false;
    if (filter === 'CANCELLED' && o.status !== 'CANCELLED' && o.status !== 'EXPIRED') return false;
    if (!['ALL', 'ATTENTION', 'CANCELLED'].includes(filter) && o.status !== filter) return false;
    if (q && !norm(`${o.code} ${o.displayName ?? ''} ${o.handle ?? ''} ${o.receiverPhone ?? ''} ${o.receiverName ?? ''}`).includes(q)) return false;
    return true;
  });
  const open = orders.find((o) => o.id === openId);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3">
          <div className="text-xs text-slate-500">Số đơn</div>
          <div className="text-2xl font-bold">{counts.ALL ?? 0}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-slate-500">Giá trị đơn đang có</div>
          <div className="text-2xl font-bold">{vnd(revenue)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-slate-500">Đã chốt</div>
          <div className="text-2xl font-bold text-emerald-700">{vnd(approvedRevenue)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-slate-500">Cần xử lý</div>
          <div className="text-2xl font-bold text-amber-600">{counts.ATTENTION ?? 0}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
            >
              {f.label} {counts[f.key] ? `(${counts[f.key]})` : ''}
            </button>
          ))}
        </div>
        <input className="input ml-auto w-full max-w-xs py-1.5" placeholder="Tìm mã đơn, tên, SĐT…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <a className="btn-ghost py-1.5" href={`/api/sessions/${sessionId}/orders/export.xlsx`}>⬇ Xuất Excel đơn</a>
      </div>

      {list.length === 0 ? (
        <Empty>{orders.length ? 'Không có đơn phù hợp' : 'Chưa có đơn. Đơn sẽ tự tạo khi khách bình luận mã sản phẩm.'}</Empty>
      ) : (
        <ul className="space-y-2">
          {list.map((o) => (
            <li key={o.id}>
              <button className="card flex w-full flex-wrap items-center gap-3 p-3 text-left hover:border-indigo-300" onClick={() => setOpenId(o.id)}>
                <span className="font-mono text-sm font-semibold">{o.code}</span>
                <PlatformBadge platform={o.platform} short />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{o.receiverName ?? o.displayName ?? o.handle}</span>
                    {o.customer?.blacklisted && <span className="rounded bg-rose-600 px-1.5 text-[10px] font-semibold text-white">BOM</span>}
                    {o.items.some((i) => i.status === 'NEEDS_VARIANT') && <span className="text-[11px] font-medium text-rose-600">chưa rõ phân loại</span>}
                    {o.items.some((i) => i.status === 'WAITLIST') && <span className="text-[11px] font-medium text-amber-600">có hàng chờ</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">{itemsSummary(o) || '—'}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{vnd(o.total)}</div>
                  <div className="text-[11px] text-slate-500">
                    {o.paymentMethod === 'BANK' ? 'CK' : 'COD'}
                    {o.paymentStatus === 'PAID' && ' · đã trả'}
                    {o.status === 'PENDING' && o.holdUntil && ` · ${fmtCountdown(o.holdUntil)}`}
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS[o.status].cls}`}>{ORDER_STATUS[o.status].label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <OrderDetail key={`${open.id}-${open.status}-${open.confirmedAt}`} order={open} products={products} onClose={() => setOpenId(null)} />}
    </div>
  );
}
