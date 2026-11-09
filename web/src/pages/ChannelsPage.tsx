import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { Channel, Platform } from '../lib/types';
import { Empty, PlatformBadge } from '../components/ui';

const HINT: Record<Platform, string> = {
  TIKTOK: 'Nhập @username hoặc dán link kênh TikTok. Theo dõi được cả kênh của người khác.',
  FACEBOOK: 'Chỉ hỗ trợ Fanpage bạn quản trị (API chính thức). Cần Page ID và Page access token.',
  SIMULATOR: 'Kênh giả lập tự sinh bình luận, like, share… để thử hệ thống khi chưa có live thật.',
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<Platform>('TIKTOK');
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [isOwn, setIsOwn] = useState(true);
  const [error, setError] = useState('');
  const [checks, setChecks] = useState<Record<string, { ok: boolean; message: string } | 'loading'>>({});

  const load = () => api<Channel[]>('/api/channels').then(setChannels).finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/channels', {
        method: 'POST',
        body: { platform, handle, name: name || undefined, accessToken: platform === 'FACEBOOK' ? token : undefined, isOwn },
      });
      setHandle('');
      setName('');
      setToken('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (c: Channel) => {
    if (!confirm(`Xoá kênh "${c.name}"? Dữ liệu các phiên cũ của kênh này cũng bị xoá.`)) return;
    try {
      await api(`/api/channels/${c.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const check = async (c: Channel) => {
    setChecks((s) => ({ ...s, [c.id]: 'loading' }));
    const r = await api<{ ok: boolean; message: string }>(`/api/channels/${c.id}/check`, { method: 'POST' }).catch((e) => ({ ok: false, message: (e as Error).message }));
    setChecks((s) => ({ ...s, [c.id]: r }));
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <h1 className="mb-3 text-xl font-bold">Kênh live</h1>
        {loading ? (
          <p className="text-sm text-slate-500">Đang tải…</p>
        ) : channels.length === 0 ? (
          <Empty>Chưa có kênh nào. Thêm kênh ở khung bên cạnh.</Empty>
        ) : (
          <ul className="space-y-2">
            {channels.map((c) => {
              const ck = checks[c.id];
              return (
                <li key={c.id} className="card flex flex-wrap items-center gap-3 p-3">
                  <PlatformBadge platform={c.platform} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-xs text-slate-500">
                      {c.platform === 'FACEBOOK' ? `Page ID: ${c.handle}` : c.platform === 'TIKTOK' ? `@${c.handle}` : c.handle}
                      {' · '}
                      {c.isOwn ? 'Kênh của tôi' : 'Kênh theo dõi'}
                    </div>
                    {ck && ck !== 'loading' && (
                      <div className={`mt-1 text-xs ${ck.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{ck.message}</div>
                    )}
                  </div>
                  <button className="btn-ghost py-1.5" onClick={() => check(c)} disabled={ck === 'loading'}>
                    {ck === 'loading' ? 'Đang kiểm tra…' : 'Kiểm tra'}
                  </button>
                  <button className="btn-ghost py-1.5 text-rose-600" onClick={() => remove(c)}>Xoá</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form onSubmit={add} className="card h-fit space-y-3 p-4">
        <h2 className="font-semibold">Thêm kênh</h2>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
          {(['TIKTOK', 'FACEBOOK', 'SIMULATOR'] as Platform[]).map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setPlatform(p)}
              className={`rounded-md py-1.5 text-sm font-medium ${platform === p ? 'bg-white shadow-sm' : 'text-slate-600'}`}
            >
              {p === 'TIKTOK' ? 'TikTok' : p === 'FACEBOOK' ? 'Fanpage' : 'Giả lập'}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">{HINT[platform]}</p>
        <div>
          <label className="label" htmlFor="handle">{platform === 'TIKTOK' ? 'Username / link kênh' : platform === 'FACEBOOK' ? 'Page ID' : 'Mã kênh giả lập'}</label>
          <input id="handle" className="input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={platform === 'TIKTOK' ? '@tenshop' : platform === 'FACEBOOK' ? '1234567890' : 'demo'} required />
        </div>
        {platform === 'FACEBOOK' && (
          <div>
            <label className="label" htmlFor="token">Page access token</label>
            <textarea id="token" className="input font-mono text-xs" rows={3} value={token} onChange={(e) => setToken(e.target.value)} required />
          </div>
        )}
        <div>
          <label className="label" htmlFor="name">Tên hiển thị (không bắt buộc)</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isOwn} onChange={(e) => setIsOwn(e.target.checked)} />
          Kênh của tôi (bỏ chọn nếu là kênh người khác đang theo dõi)
        </label>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <button className="btn-primary w-full">Thêm kênh</button>
      </form>
    </div>
  );
}
