import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { vnd } from '../../lib/format';
import type { Comment, SessionProduct } from '../../lib/types';
import Modal from '../Modal';

/** Tạo đơn thủ công từ 1 bình luận (khi hệ thống không tự nhận ra) */
export default function ManualOrder({ sessionId, comment, products, onClose }: { sessionId: string; comment: Comment; products: SessionProduct[]; onClose: () => void }) {
  const open = products.filter((p) => p.status !== 'CLOSED');
  const [spId, setSpId] = useState(open[0]?.id ?? '');
  const [variantId, setVariantId] = useState('');
  const [qty, setQty] = useState(1);
  const [error, setError] = useState('');
  const sp = products.find((p) => p.id === spId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!comment.user) return;
    setError('');
    try {
      await api(`/api/sessions/${sessionId}/orders/manual`, {
        method: 'POST',
        body: {
          platform: comment.platform,
          platformUserId: comment.user.id,
          name: comment.user.name,
          handle: comment.user.handle,
          sourceText: comment.content,
          items: [{ sessionProductId: spId, variantId: variantId || undefined, quantity: qty }],
        },
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title="Tạo đơn từ bình luận" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="rounded-lg bg-slate-50 p-2 text-sm">
          <b>{comment.user?.name ?? comment.user?.handle ?? 'Ẩn danh'}</b>: {comment.content}
        </div>
        {!comment.user ? (
          <p className="text-sm text-rose-700">Không xác định được người bình luận nên không tạo đơn được.</p>
        ) : open.length === 0 ? (
          <p className="text-sm text-slate-500">Phiên chưa có sản phẩm đang mở bán.</p>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="mo-sp">Sản phẩm</label>
              <select id="mo-sp" className="input" value={spId} onChange={(e) => { setSpId(e.target.value); setVariantId(''); }}>
                {open.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} · {p.product.name} · {vnd(p.livePrice ?? p.product.price)} · còn {p.available}</option>
                ))}
              </select>
            </div>
            {sp && sp.product.variants.length > 1 && (
              <div>
                <label className="label" htmlFor="mo-v">Phân loại</label>
                <select id="mo-v" className="input" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                  <option value="">— Chưa rõ (chọn sau) —</option>
                  {sp.product.variants.map((v) => (
                    <option key={v.id} value={v.id}>{v.label} (còn {v.available})</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="mo-q">Số lượng</label>
              <input id="mo-q" className="input w-24" type="number" min={1} max={99} value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} />
            </div>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <button className="btn-primary w-full">Tạo / thêm vào đơn của khách</button>
          </>
        )}
      </form>
    </Modal>
  );
}
