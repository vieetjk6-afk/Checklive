import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { vnd } from '../../lib/format';
import { papi } from '../../lib/publicApi';

interface SessionInfo {
  shopName: string;
  title: string;
  status: string;
  products: { code: string; name: string; imageUrl: string | null; price: number; status: string; available: number }[];
}
interface Found {
  code: string;
  name: string;
  status: string;
  total: number;
  token: string;
  items: { code: string; productName: string; variantLabel: string | null; quantity: number; status: string }[];
}

/** Trang khách quét QR trên live: xem sản phẩm, tra cứu và xác nhận đơn */
export default function LookupPage() {
  const { publicId = '' } = useParams();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    papi<SessionInfo>(`/api/public/s/${publicId}`).then(setInfo).catch((e) => setError(e.message));
  }, [publicId]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setFound(await papi<Found[]>(`/api/public/s/${publicId}/lookup?q=${encodeURIComponent(q.trim())}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !info) return <div className="p-6 text-center text-slate-600">{error}</div>;
  if (!info) return <div className="p-6 text-center text-slate-500">Đang tải…</div>;

  return (
    <div className="mx-auto min-h-screen max-w-md space-y-4 px-4 py-5">
      <header className="text-center">
        <div className="text-lg font-bold">{info.shopName}</div>
        <div className="text-sm text-slate-500">{info.title}</div>
      </header>

      <form onSubmit={search} className="card space-y-3 p-4">
        <h1 className="font-semibold">Xác nhận đơn đã chốt trên live</h1>
        <div>
          <label className="label" htmlFor="q">@username TikTok hoặc tên Facebook của bạn</label>
          <input id="q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="@tencuaban" required minLength={2} />
        </div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Đang tìm…' : 'Tìm đơn của tôi'}</button>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        {found && found.length === 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Chưa tìm thấy đơn. Hãy nhập đúng tên hiển thị khi bình luận (TikTok nhập @username), hoặc nhắn tin cho shop.
          </p>
        )}
        {found?.map((o) => (
          <div key={o.code} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between text-sm">
              <span>Đơn <b className="font-mono">{o.code}</b> · {o.name}</span>
              <b>{vnd(o.total)}</b>
            </div>
            <ul className="mt-1 text-xs text-slate-600">
              {o.items.map((i, k) => (
                <li key={k}>
                  {i.code} {i.productName} {i.variantLabel ? `(${i.variantLabel})` : ''} ×{i.quantity}
                  {i.status === 'WAITLIST' && <span className="text-amber-700"> · đang chờ hàng</span>}
                  {i.status === 'NEEDS_VARIANT' && <span className="text-rose-700"> · cần chọn phân loại</span>}
                </li>
              ))}
            </ul>
            <Link to={`/o/${o.token}`} className="btn-primary mt-2 w-full">{o.status === 'CONFIRMED' ? 'Xem / sửa đơn' : 'Xác nhận đơn này'}</Link>
          </div>
        ))}
      </form>

      {info.products.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Sản phẩm trong phiên</h2>
          <ul className="space-y-2">
            {info.products.map((p) => (
              <li key={p.code} className="flex items-center gap-3">
                {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="h-12 w-12 rounded-lg bg-slate-100" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    <span className="mr-1 rounded bg-indigo-600 px-1.5 py-0.5 text-xs font-bold text-white">{p.code}</span>
                    {p.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {vnd(p.price)} · {p.available > 0 ? `còn ${p.available}` : 'tạm hết'}
                    {p.status === 'SELLING' && <span className="ml-1 font-semibold text-rose-600">● Đang bán</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">Muốn mua: bình luận mã sản phẩm trên live, VD <b>A1 đỏ M 2</b>.</p>
        </section>
      )}
    </div>
  );
}
