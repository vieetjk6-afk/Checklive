import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { BANKS, ORDER_STATUS, fmtCountdown, vnd } from '../../lib/format';
import { papi } from '../../lib/publicApi';
import Qr from '../../components/Qr';

interface PublicOrder {
  code: string;
  shopName: string;
  sessionTitle: string;
  status: string;
  total: number;
  holdUntil: string | null;
  displayName: string | null;
  paymentMethod: 'COD' | 'BANK';
  paymentStatus: 'UNPAID' | 'PAID';
  bankAvailable: boolean;
  saved: { name: string; phone: string; address: string } | null;
  receiver: { name: string; phone: string; address: string } | null;
  items: {
    id: string;
    code: string;
    productName: string;
    imageUrl: string | null;
    variantLabel: string | null;
    unitPrice: number;
    quantity: number;
    status: string;
    variants?: { id: string; label: string; available: number }[];
  }[];
}

interface Payment { payload: string; bankBin: string; accountNo: string; accountName: string | null; amount: number; note: string }

function BankBox({ token }: { token: string }) {
  const [pay, setPay] = useState<Payment | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    papi<Payment>(`/api/public/o/${token}/payment`).then(setPay).catch((e) => setErr(e.message));
  }, [token]);
  if (err) return <p className="text-sm text-rose-700">{err}</p>;
  if (!pay) return null;
  const bank = BANKS.find((b) => b.bin === pay.bankBin)?.name ?? pay.bankBin;
  return (
    <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 text-center">
      <div className="font-semibold">Quét mã để chuyển khoản</div>
      <Qr value={pay.payload} size={220} className="mx-auto rounded-lg bg-white p-2" />
      <div className="text-sm">
        <div>{bank} · <b>{pay.accountNo}</b></div>
        {pay.accountName && <div>{pay.accountName}</div>}
        <div>Số tiền: <b>{vnd(pay.amount)}</b></div>
        <div>Nội dung: <b className="font-mono">{pay.note}</b></div>
      </div>
      <p className="text-xs text-slate-500">Shop sẽ kiểm tra và xác nhận thanh toán.</p>
    </div>
  );
}

/** Trang khách tự xác nhận đơn: chọn phân loại, nhập địa chỉ, chọn thanh toán */
export default function ConfirmPage() {
  const { token = '' } = useParams();
  const [o, setO] = useState<PublicOrder | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [useSaved, setUseSaved] = useState(true);
  const [form, setForm] = useState({ receiverName: '', receiverPhone: '', receiverAddress: '', note: '' });
  const [payment, setPayment] = useState<'COD' | 'BANK'>('COD');
  const [choices, setChoices] = useState<Record<string, string>>({});

  const load = () =>
    papi<PublicOrder>(`/api/public/o/${token}`)
      .then((d) => {
        setO(d);
        setPayment(d.paymentMethod);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = useSaved && !!o?.saved;
      await papi(`/api/public/o/${token}/confirm`, {
        method: 'POST',
        body: {
          ...(saved ? {} : form),
          note: form.note,
          useSaved: saved,
          paymentMethod: payment,
          variantChoices: choices,
        },
      });
      setDone(true);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!o) return <div className="p-6 text-center text-slate-600">{error || 'Đang tải…'}</div>;

  const editable = o.status === 'PENDING' || o.status === 'CONFIRMED';
  const needs = o.items.filter((i) => i.status === 'NEEDS_VARIANT');
  const st = ORDER_STATUS[o.status];

  return (
    <div className="mx-auto min-h-screen max-w-md space-y-4 px-4 py-5">
      <header className="text-center">
        <div className="text-lg font-bold">{o.shopName}</div>
        <div className="text-sm text-slate-500">{o.sessionTitle}</div>
      </header>

      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="font-semibold">Đơn <span className="font-mono">{o.code}</span></h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
        </div>
        {o.status === 'PENDING' && o.holdUntil && <p className="mb-2 text-xs text-amber-700">Shop giữ hàng cho bạn {fmtCountdown(o.holdUntil)}. Vui lòng xác nhận sớm.</p>}
        <ul className="divide-y divide-slate-100">
          {o.items.map((i) => (
            <li key={i.id} className="flex gap-3 py-2">
              {i.imageUrl ? <img src={i.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="h-12 w-12 rounded-lg bg-slate-100" />}
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{i.code} · {i.productName}</div>
                <div className="text-xs text-slate-500">
                  {i.variantLabel && `${i.variantLabel} · `}
                  {vnd(i.unitPrice)} × {i.quantity}
                  {i.status === 'WAITLIST' && <span className="text-amber-700"> · đang chờ hàng (chưa tính tiền)</span>}
                </div>
                {i.status === 'NEEDS_VARIANT' && editable && (
                  <select
                    className="input mt-1 py-1.5 text-sm"
                    value={choices[i.id] ?? ''}
                    onChange={(e) => setChoices({ ...choices, [i.id]: e.target.value })}
                    required
                    aria-label={`Chọn phân loại cho ${i.code}`}
                  >
                    <option value="">— Chọn phân loại —</option>
                    {i.variants?.map((v) => (
                      <option key={v.id} value={v.id} disabled={v.available === 0}>
                        {v.label}{v.available === 0 ? ' (hết)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold">
          <span>Tạm tính</span>
          <span>{vnd(o.total)}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">Phí giao hàng (nếu có) shop sẽ báo khi chốt đơn.</p>
      </section>

      {done && (
        <div className="rounded-xl bg-emerald-50 p-4 text-center text-emerald-800">
          <div className="text-lg font-semibold">✓ Đã xác nhận đơn</div>
          <p className="text-sm">Shop sẽ kiểm tra và giao hàng cho bạn. Cảm ơn bạn!</p>
        </div>
      )}

      {editable && !done && (
        <form onSubmit={submit} className="card space-y-3 p-4">
          <h2 className="font-semibold">Thông tin nhận hàng</h2>
          {o.saved && (
            <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 text-sm">
              <input type="checkbox" className="mt-1" checked={useSaved} onChange={(e) => setUseSaved(e.target.checked)} />
              <span>
                Dùng thông tin lần trước: <b>{o.saved.name}</b>, {o.saved.phone}, {o.saved.address}
              </span>
            </label>
          )}
          {(!o.saved || !useSaved) && (
            <>
              <input className="input" placeholder="Họ tên người nhận" value={form.receiverName} onChange={(e) => setForm({ ...form, receiverName: e.target.value })} required autoComplete="name" />
              <input className="input" placeholder="Số điện thoại" inputMode="tel" value={form.receiverPhone} onChange={(e) => setForm({ ...form, receiverPhone: e.target.value })} required autoComplete="tel" />
              <textarea className="input" rows={2} placeholder="Địa chỉ: số nhà, đường, phường/xã, quận/huyện, tỉnh/thành" value={form.receiverAddress} onChange={(e) => setForm({ ...form, receiverAddress: e.target.value })} required autoComplete="street-address" />
            </>
          )}
          <input className="input" placeholder="Ghi chú cho shop (không bắt buộc)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="space-y-1 text-sm">
            <span className="label">Thanh toán</span>
            <label className="flex items-center gap-2"><input type="radio" checked={payment === 'COD'} onChange={() => setPayment('COD')} /> Thanh toán khi nhận hàng (COD)</label>
            {o.bankAvailable && (
              <label className="flex items-center gap-2"><input type="radio" checked={payment === 'BANK'} onChange={() => setPayment('BANK')} /> Chuyển khoản ngân hàng</label>
            )}
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button className="btn-primary w-full py-3 text-base" disabled={busy || needs.some((i) => !choices[i.id])}>
            {busy ? 'Đang gửi…' : o.status === 'CONFIRMED' ? 'Cập nhật thông tin' : 'Xác nhận đơn hàng'}
          </button>
        </form>
      )}

      {o.receiver && (
        <section className="card p-4 text-sm">
          <h2 className="mb-1 font-semibold">Giao đến</h2>
          <div>{o.receiver.name} · {o.receiver.phone}</div>
          <div className="text-slate-500">{o.receiver.address}</div>
        </section>
      )}

      {o.paymentMethod === 'BANK' && o.paymentStatus === 'UNPAID' && o.status !== 'PENDING' && !['CANCELLED', 'EXPIRED'].includes(o.status) && <BankBox token={token} />}
      {o.paymentStatus === 'PAID' && <p className="text-center text-sm font-medium text-emerald-700">✓ Shop đã nhận thanh toán</p>}
    </div>
  );
}
