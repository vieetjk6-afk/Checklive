import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { HOLD_OPTIONS, fmtNum, vnd } from '../../lib/format';
import type { Product, SalesSettings, SessionProduct, SessionProductStatus } from '../../lib/types';
import Qr from '../Qr';
import { Empty } from '../ui';

const SP_STATUS: Record<SessionProductStatus, { label: string; cls: string }> = {
  WAITING: { label: 'Chờ bán', cls: 'bg-slate-100 text-slate-700' },
  SELLING: { label: 'Đang bán', cls: 'bg-rose-100 text-rose-700' },
  CLOSED: { label: 'Đã đóng', cls: 'bg-slate-200 text-slate-500' },
};

export async function setProductStatus(sessionId: string, spId: string, status: SessionProductStatus) {
  await api(`/api/sessions/${sessionId}/products/${spId}`, { method: 'PATCH', body: { status } });
}

/** Nút đổi trạng thái bán của 1 sản phẩm */
export function StatusButtons({ sessionId, sp, onChanged }: { sessionId: string; sp: SessionProduct; onChanged?: () => void }) {
  const run = async (s: SessionProductStatus) => {
    try {
      await setProductStatus(sessionId, sp.id, s);
      onChanged?.();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  if (sp.status === 'SELLING') return <button className="btn-ghost px-2 py-1 text-xs" onClick={() => run('CLOSED')}>■ Dừng bán</button>;
  return (
    <button className="btn-primary px-2 py-1 text-xs" onClick={() => run('SELLING')}>
      ▶ {sp.status === 'CLOSED' ? 'Mở lại' : 'Bán'}
    </button>
  );
}

function AddProduct({ sessionId, onAdded }: { sessionId: string; onAdded: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [code, setCode] = useState('');
  const [livePrice, setLivePrice] = useState('');
  const [sessionLimit, setSessionLimit] = useState('');
  const [perCustomer, setPerCustomer] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<Product[]>('/api/products').then(setProducts).catch(() => undefined);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const num = (s: string) => (s.trim() ? Number(s.replace(/\D/g, '')) : null);
    try {
      await api(`/api/sessions/${sessionId}/products`, {
        method: 'POST',
        body: { productId, code: code.trim() || undefined, livePrice: num(livePrice), sessionLimit: num(sessionLimit), perCustomerLimit: num(perCustomer) || null },
      });
      setProductId('');
      setCode('');
      setLivePrice('');
      setSessionLimit('');
      setPerCustomer('');
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const selected = products.find((p) => p.id === productId);

  return (
    <form onSubmit={submit} className="card space-y-3 p-3">
      <h3 className="text-sm font-semibold">Thêm sản phẩm vào phiên</h3>
      {products.length === 0 ? (
        <p className="text-sm text-slate-500">Kho chưa có sản phẩm. Vào mục <b>Sản phẩm</b> để thêm trước.</p>
      ) : (
        <>
          <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)} required aria-label="Chọn sản phẩm">
            <option value="">— Chọn sản phẩm trong kho —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {vnd(p.price)} · còn {p.variants.reduce((s, v) => s + v.available, 0)}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label className="label text-xs" htmlFor="sp-code">Mã live</label>
              <input id="sp-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Tự động (A1…)" />
            </div>
            <div>
              <label className="label text-xs" htmlFor="sp-price">Giá live</label>
              <input id="sp-price" className="input" inputMode="numeric" value={livePrice} onChange={(e) => setLivePrice(e.target.value)} placeholder={selected ? String(selected.price) : 'giá gốc'} />
            </div>
            <div>
              <label className="label text-xs" htmlFor="sp-limit">SL mở bán</label>
              <input id="sp-limit" className="input" inputMode="numeric" value={sessionLimit} onChange={(e) => setSessionLimit(e.target.value)} placeholder="theo kho" />
            </div>
            <div>
              <label className="label text-xs" htmlFor="sp-per">Tối đa/khách</label>
              <input id="sp-per" className="input" inputMode="numeric" value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} placeholder="không giới hạn" />
            </div>
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button className="btn-primary w-full" disabled={!productId}>Thêm vào phiên</button>
        </>
      )}
    </form>
  );
}

function ProductRow({ sessionId, sp, onChanged }: { sessionId: string; sp: SessionProduct; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(sp.code);
  const [livePrice, setLivePrice] = useState(sp.livePrice === null ? '' : String(sp.livePrice));
  const [sessionLimit, setSessionLimit] = useState(sp.sessionLimit === null ? '' : String(sp.sessionLimit));
  const [perCustomer, setPerCustomer] = useState(sp.perCustomerLimit === null ? '' : String(sp.perCustomerLimit));

  const save = async () => {
    const num = (s: string) => (s.trim() ? Number(s.replace(/\D/g, '')) : null);
    try {
      await api(`/api/sessions/${sessionId}/products/${sp.id}`, {
        method: 'PATCH',
        body: { code: code.trim(), livePrice: num(livePrice), sessionLimit: num(sessionLimit), perCustomerLimit: num(perCustomer) || null },
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm(`Gỡ ${sp.code} khỏi phiên?`)) return;
    try {
      await api(`/api/sessions/${sessionId}/products/${sp.id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const price = sp.livePrice ?? sp.product.price;
  return (
    <li className={`card p-3 ${sp.status === 'SELLING' ? 'border-rose-300 ring-1 ring-rose-200' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 min-w-[2.5rem] place-items-center rounded-lg bg-indigo-600 px-2 text-sm font-bold text-white">{sp.code}</span>
        {sp.product.imageUrl && <img src={sp.product.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{sp.product.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SP_STATUS[sp.status].cls}`}>{SP_STATUS[sp.status].label}</span>
          </div>
          <div className="text-xs text-slate-500">
            {vnd(price)}
            {sp.livePrice !== null && sp.livePrice !== sp.product.price && <span className="ml-1 line-through">{vnd(sp.product.price)}</span>}
            {' · '}Còn <b className={sp.available === 0 ? 'text-rose-600' : 'text-slate-700'}>{fmtNum(sp.available)}</b>
            {sp.sessionLimit !== null && ` / mở bán ${sp.sessionLimit}`}
            {' · '}Đã giữ {fmtNum(sp.orderedQty)}
            {sp.waitlistQty > 0 && <span className="text-amber-700"> · Chờ hàng {sp.waitlistQty}</span>}
            {sp.needsVariantQty > 0 && <span className="text-rose-700"> · Chưa rõ phân loại {sp.needsVariantQty}</span>}
            {sp.perCustomerLimit !== null && ` · Tối đa ${sp.perCustomerLimit}/khách`}
          </div>
        </div>
        <div className="flex gap-1">
          <StatusButtons sessionId={sessionId} sp={sp} onChanged={onChanged} />
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(!editing)}>Sửa</button>
        </div>
      </div>
      {sp.product.variants.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {sp.product.variants.map((v) => (
            <span key={v.id} className={`rounded px-1.5 py-0.5 text-[11px] ${v.available ? 'bg-slate-100 text-slate-700' : 'bg-rose-50 text-rose-500 line-through'}`}>
              {v.label} · {v.available}
            </span>
          ))}
        </div>
      )}
      {editing && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-5">
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Mã live" />
          <input className="input" inputMode="numeric" value={livePrice} onChange={(e) => setLivePrice(e.target.value)} placeholder="Giá live" aria-label="Giá live" />
          <input className="input" inputMode="numeric" value={sessionLimit} onChange={(e) => setSessionLimit(e.target.value)} placeholder="SL mở bán" aria-label="SL mở bán" />
          <input className="input" inputMode="numeric" value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} placeholder="Tối đa/khách" aria-label="Tối đa mỗi khách" />
          <div className="col-span-2 flex gap-1 sm:col-span-1">
            <button className="btn-primary flex-1 px-2" onClick={save}>Lưu</button>
            <button className="btn-ghost px-2 text-rose-600" onClick={remove} title="Gỡ khỏi phiên">✕</button>
          </div>
        </div>
      )}
    </li>
  );
}

function SettingsCard({ sessionId, settings, onSaved }: { sessionId: string; settings: SalesSettings; onSaved: () => void }) {
  const [hold, setHold] = useState<string>(settings.holdMinutes === null ? 'none' : String(settings.holdMinutes));
  const [mode, setMode] = useState(settings.orderMode);
  const [keywords, setKeywords] = useState(settings.orderKeywords.join(', '));
  const [msg, setMsg] = useState('');

  const save = async () => {
    setMsg('');
    try {
      await api(`/api/sessions/${sessionId}/sales-settings`, {
        method: 'PATCH',
        body: {
          holdMinutes: hold === 'none' ? null : Number(hold),
          orderMode: mode,
          orderKeywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
        },
      });
      setMsg('Đã lưu');
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const holdOptions = HOLD_OPTIONS.some((o) => String(o.value ?? 'none') === hold) ? HOLD_OPTIONS : [...HOLD_OPTIONS, { value: Number(hold), label: `${hold} phút` }];

  return (
    <div className="card space-y-3 p-3">
      <h3 className="text-sm font-semibold">Cài đặt chốt đơn</h3>
      <div>
        <label className="label text-xs" htmlFor="hold">Giữ hàng khi khách chưa xác nhận</label>
        <select id="hold" className="input" value={hold} onChange={(e) => setHold(e.target.value)}>
          {holdOptions.map((o) => (
            <option key={String(o.value)} value={o.value === null ? 'none' : String(o.value)}>{o.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">Quá thời gian này đơn tự huỷ, hàng chuyển cho người đang chờ.</p>
      </div>
      <div>
        <span className="label text-xs">Nhận mã nào</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={mode === 'ALL_CODES'} onChange={() => setMode('ALL_CODES')} /> Mọi mã trong phiên (trừ mã đã đóng)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={mode === 'SELLING_ONLY'} onChange={() => setMode('SELLING_ONLY')} /> Chỉ sản phẩm đang bán
        </label>
      </div>
      <div>
        <label className="label text-xs" htmlFor="kw">Từ khoá chốt (cho sản phẩm đang bán)</label>
        <input id="kw" className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="chot, +1, lay" />
        <p className="mt-1 text-xs text-slate-500">Khách chỉ cần bình luận từ khoá (VD "chốt đỏ M 2") là chốt sản phẩm vừa mở bán.</p>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-primary" onClick={save}>Lưu cài đặt</button>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}

function LinksCard({ publicId }: { publicId: string }) {
  const lookup = `${window.location.origin}/s/${publicId}`;
  const overlay = `${window.location.origin}/overlay/${publicId}`;
  const copy = (s: string) => navigator.clipboard?.writeText(s).catch(() => undefined);
  return (
    <div className="card space-y-3 p-3">
      <h3 className="text-sm font-semibold">Cho khách & màn hình live</h3>
      <div className="flex gap-3">
        <Qr value={lookup} size={96} />
        <div className="min-w-0 flex-1 text-xs">
          <div className="font-medium text-slate-700">Trang tra cứu & xác nhận đơn</div>
          <p className="text-slate-500">Khách quét QR, nhập @username TikTok / tên Facebook để xác nhận đơn.</p>
          <div className="mt-1 flex gap-1">
            <a className="btn-ghost px-2 py-1 text-xs" href={lookup} target="_blank" rel="noreferrer">Mở</a>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => copy(lookup)}>Sao chép link</button>
          </div>
        </div>
      </div>
      <div className="text-xs">
        <div className="font-medium text-slate-700">Overlay cho OBS / TikTok LIVE Studio</div>
        <p className="text-slate-500">Thêm nguồn "Browser" với link này (khung 1920×1080, nền trong suốt).</p>
        <div className="mt-1 flex gap-1">
          <a className="btn-ghost px-2 py-1 text-xs" href={overlay} target="_blank" rel="noreferrer">Xem thử</a>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => copy(overlay)}>Sao chép link</button>
        </div>
      </div>
    </div>
  );
}

export default function SalesTab({ sessionId, products, onProductsChanged }: { sessionId: string; products: SessionProduct[]; onProductsChanged: () => void }) {
  const [settings, setSettings] = useState<SalesSettings | null>(null);
  const loadSettings = () => api<SalesSettings>(`/api/sessions/${sessionId}/sales-settings`).then(setSettings).catch(() => undefined);
  useEffect(() => {
    void loadSettings();
  }, [sessionId]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        <AddProduct sessionId={sessionId} onAdded={onProductsChanged} />
        {products.length === 0 ? (
          <Empty>Chưa có sản phẩm trong phiên. Thêm sản phẩm từ kho, mỗi sản phẩm có một mã live để khách bình luận.</Empty>
        ) : (
          <ul className="space-y-2">
            {products.map((sp) => (
              <ProductRow key={`${sp.id}-${sp.code}-${sp.livePrice}-${sp.sessionLimit}-${sp.perCustomerLimit}`} sessionId={sessionId} sp={sp} onChanged={onProductsChanged} />
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-3">
        {settings && <SettingsCard key={settings.publicId} sessionId={sessionId} settings={settings} onSaved={loadSettings} />}
        {settings && <LinksCard publicId={settings.publicId} />}
        <div className="card p-3 text-xs text-slate-600">
          <div className="mb-1 font-semibold text-slate-700">Cú pháp khách bình luận</div>
          <ul className="list-disc space-y-0.5 pl-4">
            <li><b>A1</b> · <b>A1 2</b> · <b>A1 x2</b> · <b>2 cái A1</b></li>
            <li><b>A1 đỏ M</b> · <b>a1 do m 2</b> (không cần dấu)</li>
            <li><b>A1 đỏ M, A2 L</b> · <b>A1 + A3</b> (nhiều sản phẩm)</li>
            <li><b>chốt</b> · <b>+1</b> · <b>chốt đỏ M</b> → sản phẩm đang bán</li>
            <li>Câu hỏi như "A1 còn không?" sẽ không tạo đơn</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
