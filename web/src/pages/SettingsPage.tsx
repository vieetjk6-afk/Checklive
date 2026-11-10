import { useEffect, useState, type FormEvent } from 'react';

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== again) return setMsg('Hai lần nhập mật khẩu mới không giống nhau');
    try {
      await api('/api/auth/password', { method: 'POST', body: { current, next } });
      setMsg('✓ Đã đổi mật khẩu');
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h2 className="font-semibold">Đổi mật khẩu đăng nhập</h2>
      <input className="input" type="password" placeholder="Mật khẩu hiện tại" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="input" type="password" placeholder="Mật khẩu mới (ít nhất 8 ký tự)" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        <input className="input" type="password" placeholder="Nhập lại mật khẩu mới" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-ghost">Đổi mật khẩu</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </form>
  );
}
import { api } from '../lib/api';
import { BANKS, HOLD_OPTIONS } from '../lib/format';
import type { ShopSettings } from '../lib/types';
import Qr from '../components/Qr';

function SettingsPage() {
  const [s, setS] = useState<ShopSettings | null>(null);
  const [customBin, setCustomBin] = useState(false);
  const [msg, setMsg] = useState('');
  const [testQr, setTestQr] = useState('');

  useEffect(() => {
    api<ShopSettings>('/api/shop').then((d) => {
      setS(d);
      setCustomBin(!!d.bankBin && !BANKS.some((b) => b.bin === d.bankBin));
    });
  }, []);

  if (!s) return <p className="text-sm text-slate-500">Đang tải…</p>;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    setTestQr('');
    try {
      await api('/api/shop', { method: 'PUT', body: { ...s, bankBin: s.bankBin || '', bankAccountNo: s.bankAccountNo || '', bankAccountName: s.bankAccountName || '' } });
      setMsg('Đã lưu');
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const showTest = async () => {
    try {
      setTestQr((await api<{ payload: string }>('/api/shop/test-qr')).payload);
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <form onSubmit={save} className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-bold">Cài đặt shop</h1>
      <div className="card space-y-3 p-4">
        <div>
          <label className="label" htmlFor="shop-name">Tên shop (hiện trên trang khách xác nhận đơn)</label>
          <input id="shop-name" className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor="hold">Thời gian giữ hàng mặc định cho phiên mới</label>
          <select id="hold" className="input" value={s.defaultHoldMinutes === null ? 'none' : String(s.defaultHoldMinutes)} onChange={(e) => setS({ ...s, defaultHoldMinutes: e.target.value === 'none' ? null : Number(e.target.value) })}>
            {HOLD_OPTIONS.map((o) => (
              <option key={String(o.value)} value={o.value === null ? 'none' : String(o.value)}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <div>
          <h2 className="font-semibold">Tài khoản nhận chuyển khoản</h2>
          <p className="text-xs text-slate-500">Dùng để tạo mã VietQR (đúng số tiền, nội dung là mã đơn) cho khách chọn chuyển khoản. Shop tự kiểm tra tiền về và bấm "Đã thanh toán".</p>
        </div>
        <div>
          <label className="label" htmlFor="bank">Ngân hàng</label>
          <select
            id="bank"
            className="input"
            value={customBin ? 'other' : s.bankBin ?? ''}
            onChange={(e) => {
              if (e.target.value === 'other') {
                setCustomBin(true);
              } else {
                setCustomBin(false);
                setS({ ...s, bankBin: e.target.value || null });
              }
            }}
          >
            <option value="">— Chưa dùng chuyển khoản —</option>
            {BANKS.map((b) => (
              <option key={b.bin} value={b.bin}>{b.name}</option>
            ))}
            <option value="other">Ngân hàng khác (nhập mã BIN)</option>
          </select>
        </div>
        {customBin && (
          <div>
            <label className="label" htmlFor="bin">Mã BIN ngân hàng (6 số)</label>
            <input id="bin" className="input" inputMode="numeric" value={s.bankBin ?? ''} onChange={(e) => setS({ ...s, bankBin: e.target.value })} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="acc">Số tài khoản</label>
            <input id="acc" className="input" value={s.bankAccountNo ?? ''} onChange={(e) => setS({ ...s, bankAccountNo: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="accname">Tên chủ tài khoản</label>
            <input id="accname" className="input uppercase" value={s.bankAccountName ?? ''} onChange={(e) => setS({ ...s, bankAccountName: e.target.value })} />
          </div>
        </div>
        {s.bankBin && s.bankAccountNo && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <b>Quan trọng:</b> sau khi lưu, bấm "Quét thử" và dùng app ngân hàng quét mã để kiểm tra đúng tên chủ tài khoản trước khi dùng thật.
            <div className="mt-2">
              <button type="button" className="btn-ghost py-1.5" onClick={showTest}>Quét thử (10.000đ)</button>
            </div>
            {testQr && <Qr value={testQr} size={180} className="mt-2 rounded bg-white p-2" />}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary">Lưu cài đặt</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </form>
  );
}

export default function SettingsPageWithPassword() {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <SettingsPage />
      <PasswordCard />
    </div>
  );
}
