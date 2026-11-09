import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { vnd } from '../../lib/format';
import { papi } from '../../lib/publicApi';
import Qr from '../../components/Qr';

interface OverlayData {
  shopName: string;
  selling: { code: string; name: string; imageUrl: string | null; price: number; originalPrice: number; available: number; sessionLimit: number | null }[];
  recent: { id: string; name: string; code: string; variantLabel: string | null; quantity: number; at: string }[];
}

/**
 * Overlay cho OBS / TikTok LIVE Studio (nguồn Browser, nền trong suốt).
 * Tham số: ?qr=0 ẩn mã QR, ?pos=left|right
 */
export default function OverlayPage() {
  const { publicId = '' } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState<OverlayData | null>(null);
  const showQr = params.get('qr') !== '0';
  const right = params.get('pos') !== 'left';

  useEffect(() => {
    document.body.style.background = 'transparent';
    document.body.classList.remove('bg-slate-50');
    let stop = false;
    const tick = async () => {
      try {
        const d = await papi<OverlayData>(`/api/public/s/${publicId}/overlay`);
        if (!stop) setData(d);
      } catch {
        /* giữ dữ liệu cũ */
      }
      if (!stop) setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [publicId]);

  if (!data) return null;
  const p = data.selling[0];
  const lookup = `${window.location.origin}/s/${publicId}`;

  return (
    <div className={`fixed bottom-8 flex w-[420px] flex-col gap-3 ${right ? 'right-8' : 'left-8'}`} style={{ fontFamily: '"Be Vietnam Pro", sans-serif' }}>
      {data.recent.length > 0 && (
        <ul className="space-y-1.5">
          {data.recent.slice(0, 4).map((r) => (
            <li key={r.id} className="w-fit rounded-full bg-black/60 px-3 py-1 text-sm text-white backdrop-blur">
              🛒 <b>{r.name}</b> vừa chốt <b className="text-amber-300">{r.code}</b>
              {r.variantLabel ? ` ${r.variantLabel}` : ''} ×{r.quantity}
            </li>
          ))}
        </ul>
      )}
      {p && (
        <div className="flex gap-3 rounded-2xl bg-white/95 p-3 shadow-2xl">
          {p.imageUrl && <img src={p.imageUrl} alt="" className="h-28 w-28 rounded-xl object-cover" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-rose-600 px-2.5 py-1 text-2xl font-black text-white">{p.code}</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-rose-600">Đang bán</span>
            </div>
            <div className="mt-1 line-clamp-2 text-lg font-bold leading-tight text-slate-900">{p.name}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-black text-rose-600">{vnd(p.price)}</span>
              {p.originalPrice > p.price && <span className="text-sm text-slate-400 line-through">{vnd(p.originalPrice)}</span>}
            </div>
            <div className="text-sm font-semibold text-slate-700">{p.available > 0 ? `Còn ${p.available} sản phẩm` : 'Đã hết — bình luận để vào danh sách chờ'}</div>
            <div className="mt-0.5 text-xs text-slate-500">Bình luận: <b>{p.code} + phân loại + số lượng</b></div>
          </div>
          {showQr && (
            <div className="flex flex-col items-center justify-center">
              <Qr value={lookup} size={88} />
              <span className="mt-1 text-[10px] font-medium text-slate-500">Xác nhận đơn</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
