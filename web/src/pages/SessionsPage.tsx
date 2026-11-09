import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { SESSION_STATUS, fmtDateTime, fmtDuration, fmtNum } from '../lib/format';
import type { Channel, SessionSummary } from '../lib/types';
import { Empty, PlatformBadge } from '../components/ui';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api<SessionSummary[]>('/api/sessions'), api<Channel[]>('/api/channels')])
      .then(([s, c]) => {
        setSessions(s);
        setChannels(c);
      })
      .finally(() => setLoading(false));
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const r = await api<{ id: string }>('/api/sessions', { method: 'POST', body: { title, channelIds: selected } });
      navigate(`/sessions/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <h1 className="mb-3 text-xl font-bold">Phiên live</h1>
        {loading ? (
          <p className="text-sm text-slate-500">Đang tải…</p>
        ) : sessions.length === 0 ? (
          <Empty>Chưa có phiên live nào. Tạo phiên mới ở khung bên cạnh.</Empty>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link to={`/sessions/${s.id}`} className="card flex flex-wrap items-center gap-3 p-3 hover:border-indigo-300">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{s.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SESSION_STATUS[s.status].cls}`}>{SESSION_STATUS[s.status].label}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {s.channels.map((c) => (
                        <span key={c.id} className="inline-flex items-center gap-1">
                          <PlatformBadge platform={c.platform} short /> {c.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>{s.startedAt ? fmtDateTime(s.startedAt) : `Tạo ${fmtDateTime(s.createdAt)}`}</div>
                    {s.startedAt && (
                      <div>
                        {fmtDuration(s.startedAt, s.endedAt)} · đỉnh {fmtNum(s.peakViewers)} người xem
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={create} className="card h-fit space-y-3 p-4">
        <h2 className="font-semibold">Tạo phiên live</h2>
        <div>
          <label className="label" htmlFor="title">Tên phiên</label>
          <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Live xả hàng tối thứ 6" required />
        </div>
        <div>
          <span className="label">Kênh theo dõi (chọn nhiều kênh để gộp)</span>
          {channels.length === 0 ? (
            <p className="text-sm text-slate-500">
              Chưa có kênh. <Link to="/channels" className="text-indigo-600 underline">Thêm kênh</Link>
            </p>
          ) : (
            <div className="space-y-1">
              {channels.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                  <PlatformBadge platform={c.platform} short />
                  <span className="truncate text-sm">{c.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <button className="btn-primary w-full" disabled={selected.length === 0}>Tạo phiên</button>
      </form>
    </div>
  );
}
