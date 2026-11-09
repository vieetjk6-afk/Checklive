import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { Me } from '../lib/types';

export default function LoginPage({ onLogin }: { onLogin: (me: Me) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await api<Me>('/api/auth/login', { method: 'POST', body: { email, password } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500 text-sm text-white">●</span>
            Checklive
          </div>
          <p className="mt-1 text-sm text-slate-500">Theo dõi live Facebook & TikTok</p>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="password">Mật khẩu</label>
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
      </form>
    </div>
  );
}
