import { fmtNum, vnd } from '../../lib/format';
import type { SessionProduct } from '../../lib/types';
import { StatusButtons } from './SalesTab';

/** Thanh điều khiển nhanh trong lúc live: bấm "Bán" sản phẩm nào thì "chốt"/"+1" tính cho sản phẩm đó */
export default function SellingBar({ sessionId, products, onChanged }: { sessionId: string; products: SessionProduct[]; onChanged: () => void }) {
  if (products.length === 0) return null;
  const sorted = [...products].sort((a, b) => {
    const rank = (p: SessionProduct) => (p.status === 'SELLING' ? 0 : p.status === 'WAITING' ? 1 : 2);
    return rank(a) - rank(b) || a.sortOrder - b.sortOrder;
  });
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Sản phẩm trong phiên</h3>
        <span className="hidden text-xs text-slate-500 sm:inline">Bấm "Bán" khi giới thiệu sản phẩm</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {sorted.map((sp) => (
          <div
            key={sp.id}
            className={`w-44 shrink-0 rounded-lg border p-2 ${sp.status === 'SELLING' ? 'border-rose-300 bg-rose-50' : sp.status === 'CLOSED' ? 'border-slate-200 opacity-60' : 'border-slate-200'}`}
          >
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-xs font-bold text-white">{sp.code}</span>
              <span className="truncate text-xs font-medium">{sp.product.name}</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-600">
              {vnd(sp.livePrice ?? sp.product.price)} · còn <b className={sp.available === 0 ? 'text-rose-600' : ''}>{fmtNum(sp.available)}</b>
            </div>
            <div className="text-[11px] text-slate-500">
              Đã giữ {sp.orderedQty}
              {sp.waitlistQty > 0 && ` · chờ ${sp.waitlistQty}`}
            </div>
            <div className="mt-1.5">
              <StatusButtons sessionId={sessionId} sp={sp} onChanged={onChanged} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
