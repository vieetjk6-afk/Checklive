import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { fmtNum, vnd } from '../lib/format';
import { norm } from '../lib/text';
import type { Attribute, Product } from '../lib/types';
import Modal from '../components/Modal';
import { Empty } from '../components/ui';

interface VariantRow {
  id?: string;
  options: Record<string, string>;
  sku: string;
  price: string;
  stock: string;
  reserved: number;
}

const keyOf = (attrs: Attribute[], options: Record<string, string>) => attrs.map((a) => norm(options[a.name] ?? '')).join('|');

/** Sinh danh sách phân loại từ thuộc tính (tổ hợp), giữ lại dữ liệu cũ nếu trùng */
function buildRows(attrs: Attribute[], prev: VariantRow[]): VariantRow[] {
  const valid = attrs.filter((a) => a.name.trim() && a.values.length);
  if (valid.length === 0) {
    const old = prev.find((r) => Object.keys(r.options).length === 0);
    return [old ?? { options: {}, sku: '', price: '', stock: prev[0]?.stock ?? '0', reserved: 0 }];
  }
  let combos: Record<string, string>[] = [{}];
  for (const a of valid) combos = combos.flatMap((c) => a.values.map((v) => ({ ...c, [a.name]: v })));
  const prevByKey = new Map(prev.map((r) => [keyOf(valid, r.options), r]));
  return combos.map((options) => {
    const old = prevByKey.get(keyOf(valid, options));
    return old ? { ...old, options } : { options, sku: '', price: '', stock: '0', reserved: 0 };
  });
}

function ProductForm({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [attrs, setAttrs] = useState<{ name: string; valuesText: string }[]>(
    product?.attributes.map((a) => ({ name: a.name, valuesText: a.values.join(', ') })) ?? [],
  );
  const [rows, setRows] = useState<VariantRow[]>(
    product?.variants.map((v) => ({ id: v.id, options: v.options, sku: v.sku ?? '', price: v.price === null ? '' : String(v.price), stock: String(v.stock), reserved: v.reserved })) ??
      [{ options: {}, sku: '', price: '', stock: '0', reserved: 0 }],
  );
  const [bulkStock, setBulkStock] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const parsedAttrs: Attribute[] = useMemo(
    () =>
      attrs
        .map((a) => ({ name: a.name.trim(), values: [...new Set(a.valuesText.split(',').map((v) => v.trim()).filter(Boolean))] }))
        .filter((a) => a.name && a.values.length),
    [attrs],
  );

  // Cập nhật bảng phân loại khi thuộc tính thay đổi
  useEffect(() => {
    setRows((prev) => buildRows(parsedAttrs, prev));
  }, [parsedAttrs]);

  const setRow = (i: number, patch: Partial<VariantRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = {
        name,
        price: Number(price.replace(/\D/g, '')) || 0,
        imageUrl: imageUrl.trim() || null,
        description: description.trim() || null,
        attributes: parsedAttrs,
        variants: rows.map((r) => ({
          id: r.id,
          options: r.options,
          sku: r.sku.trim() || null,
          price: r.price.trim() ? Number(r.price.replace(/\D/g, '')) : null,
          stock: Math.max(0, Number(r.stock) || 0),
        })),
      };
      if (product) await api(`/api/products/${product.id}`, { method: 'PUT', body });
      else await api('/api/products', { method: 'POST', body });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={product ? `Sửa: ${product.name}` : 'Thêm sản phẩm'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <div>
            <label className="label" htmlFor="p-name">Tên sản phẩm</label>
            <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="p-price">Giá gốc (đ)</label>
            <input id="p-price" className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="150000" required />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_80px]">
          <div>
            <label className="label" htmlFor="p-img">Link ảnh (không bắt buộc)</label>
            <input id="p-img" className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </div>
          {imageUrl && <img src={imageUrl} alt="" className="h-16 w-16 rounded-lg object-cover sm:mt-6" />}
        </div>
        <div>
          <label className="label" htmlFor="p-desc">Mô tả</label>
          <textarea id="p-desc" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Phân loại (màu, size, vị…)</span>
            {attrs.length < 3 && (
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setAttrs([...attrs, { name: attrs.length ? 'Size' : 'Màu', valuesText: '' }])}>
                + Thêm thuộc tính
              </button>
            )}
          </div>
          {attrs.length === 0 && <p className="text-xs text-slate-500">Sản phẩm không có phân loại. Bấm "Thêm thuộc tính" nếu có màu, size…</p>}
          <div className="space-y-2">
            {attrs.map((a, i) => (
              <div key={i} className="grid grid-cols-[110px_1fr_auto] gap-2">
                <input className="input" value={a.name} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Tên" aria-label="Tên thuộc tính" />
                <input className="input" value={a.valuesText} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, valuesText: e.target.value } : x)))} placeholder="Đỏ, Xanh, Trắng" aria-label="Giá trị (cách nhau bởi dấu phẩy)" />
                <button type="button" className="btn-ghost px-2 text-rose-600" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))} aria-label="Xoá thuộc tính">✕</button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Tồn kho {rows.length > 1 ? `(${rows.length} phân loại)` : ''}</span>
            {rows.length > 1 && (
              <div className="ml-auto flex items-center gap-1">
                <input className="input w-20 py-1" inputMode="numeric" placeholder="SL" value={bulkStock} onChange={(e) => setBulkStock(e.target.value)} aria-label="Tồn kho áp dụng cho tất cả" />
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => bulkStock && setRows(rows.map((r) => ({ ...r, stock: bulkStock })))}>
                  Áp dụng tất cả
                </button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">Phân loại</th>
                  <th className="px-2 py-1.5">Tồn kho</th>
                  <th className="px-2 py-1.5">Giá riêng</th>
                  <th className="px-2 py-1.5">SKU</th>
                  <th className="px-2 py-1.5 text-right">Đang giữ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-2 py-1">{Object.values(r.options).join(' / ') || 'Mặc định'}</td>
                    <td className="px-2 py-1"><input className="input w-20 py-1" inputMode="numeric" value={r.stock} onChange={(e) => setRow(i, { stock: e.target.value })} aria-label="Tồn kho" /></td>
                    <td className="px-2 py-1"><input className="input w-28 py-1" inputMode="numeric" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} placeholder="theo giá gốc" aria-label="Giá riêng" /></td>
                    <td className="px-2 py-1"><input className="input w-28 py-1" value={r.sku} onChange={(e) => setRow(i, { sku: e.target.value })} aria-label="SKU" /></td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">{r.reserved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu sản phẩm'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [search, setSearch] = useState('');

  const load = () => api<Product[]>('/api/products').then(setProducts).finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);

  const remove = async (p: Product) => {
    if (!confirm(`Xoá "${p.name}"?`)) return;
    const r = await api<{ archived: boolean }>(`/api/products/${p.id}`, { method: 'DELETE' }).catch((e) => alert(e.message));
    if (r && r.archived) alert('Sản phẩm đã dùng trong phiên live nên được ẩn khỏi kho (giữ lịch sử đơn hàng).');
    await load();
  };

  const q = norm(search.trim());
  const list = products.filter((p) => !q || norm(p.name).includes(q));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">Kho sản phẩm</h1>
        <input className="input ml-auto w-full max-w-xs" placeholder="Tìm sản phẩm…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn-primary" onClick={() => setEditing('new')}>+ Thêm sản phẩm</button>
      </div>
      {loading ? (
        <p className="text-sm text-slate-500">Đang tải…</p>
      ) : list.length === 0 ? (
        <Empty>{products.length ? 'Không tìm thấy sản phẩm' : 'Kho chưa có sản phẩm. Bấm "Thêm sản phẩm" để bắt đầu.'}</Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {list.map((p) => {
            const stock = p.variants.reduce((s, v) => s + v.stock, 0);
            const available = p.variants.reduce((s, v) => s + v.available, 0);
            return (
              <li key={p.id} className="card flex gap-3 p-3">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs text-slate-400">Ảnh</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-sm text-slate-600">{vnd(p.price)}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {p.variants.length > 1 ? `${p.variants.length} phân loại · ` : ''}Tồn {fmtNum(stock)} · Còn bán được {fmtNum(available)}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(p)}>Sửa</button>
                  <button className="btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => remove(p)}>Xoá</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <ProductForm
          product={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
