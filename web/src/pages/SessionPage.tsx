import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { api } from '../lib/api';
import { SESSION_STATUS, fmtDateTime, fmtDuration, fmtNum } from '../lib/format';
import type { Activity, ChannelState, Comment, Game, GameAnswer, Order, Platform, SessionDetail, SessionProduct, Stats } from '../lib/types';
import ActivityChart from '../components/ActivityChart';
import ActivityList from '../components/ActivityList';
import CommentFeed from '../components/CommentFeed';
import StatCards from '../components/StatCards';
import TopUsers from '../components/TopUsers';
import { PlatformBadge, StatusDot } from '../components/ui';
import SalesTab from '../components/sales/SalesTab';
import OrdersTab from '../components/sales/OrdersTab';
import SellingBar from '../components/sales/SellingBar';
import ManualOrder from '../components/sales/ManualOrder';
import GamesTab from '../components/games/GamesTab';

type Tab = 'live' | 'sales' | 'orders' | 'games';

const MAX_COMMENTS = 2000;
const sig = (c: Comment) => `${c.platform}|${c.user?.id ?? ''}|${c.platformTs}|${c.content}`;

export default function SessionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [states, setStates] = useState<ChannelState[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [products, setProducts] = useState<SessionProduct[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [manualFor, setManualFor] = useState<Comment | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [overlayGameId, setOverlayGameId] = useState<string | null>(null);
  const [gameAnswers, setGameAnswers] = useState<Record<string, GameAnswer[]>>({});
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'live';
  const setTab = (t: Tab) => setParams(t === 'live' ? {} : { tab: t }, { replace: true });
  const seen = useRef(new Set<string>());

  const loadProducts = useCallback(() => {
    api<SessionProduct[]>(`/api/sessions/${id}/products`).then(setProducts).catch(() => undefined);
  }, [id]);
  const loadGames = useCallback(() => {
    api<{ overlayGameId: string | null; games: Game[] }>(`/api/sessions/${id}/games`)
      .then((r) => {
        setGames(r.games);
        setOverlayGameId(r.overlayGameId);
      })
      .catch(() => undefined);
  }, [id]);
  const upsertOrder = useCallback((o: Order) => {
    setOrders((prev) => {
      const i = prev.findIndex((x) => x.id === o.id);
      if (i === -1) return [o, ...prev];
      const next = prev.slice();
      next[i] = o;
      return next;
    });
  }, []);

  const addComments = useCallback((list: Comment[], position: 'top' | 'bottom') => {
    const fresh = list.filter((c) => {
      const k = sig(c);
      if (seen.current.has(k)) return false;
      seen.current.add(k);
      return true;
    });
    if (fresh.length === 0) return;
    setComments((prev) => (position === 'top' ? [...fresh, ...prev].slice(0, MAX_COMMENTS) : [...prev, ...fresh]));
  }, []);

  const loadSession = useCallback(async () => {
    const s = await api<SessionDetail>(`/api/sessions/${id}`);
    setSession(s);
    if (s.channelStates.length) setStates(s.channelStates);
    return s;
  }, [id]);

  // Tải dữ liệu ban đầu
  useEffect(() => {
    seen.current = new Set();
    setComments([]);
    setActivities([]);
    loadSession().catch((e) => setError(e.message));
    loadProducts();
    loadGames();
    api<Order[]>(`/api/sessions/${id}/orders`).then(setOrders).catch(() => undefined);
    api<Stats>(`/api/sessions/${id}/stats`).then(setStats).catch(() => undefined);
    api<{ items: Comment[]; nextBefore: string | null }>(`/api/sessions/${id}/comments?limit=200`)
      .then((r) => {
        addComments(r.items, 'bottom');
        setNextBefore(r.nextBefore);
      })
      .catch(() => undefined);
  }, [id, loadSession, addComments, loadProducts, loadGames]);

  // Kết nối realtime
  useEffect(() => {
    const socket: Socket = io({ path: '/socket.io', transports: ['websocket'] });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', id, (r: { ok: boolean; state: ChannelState[]; stats: Stats | null }) => {
        if (!r?.ok) return;
        if (r.state.length) setStates(r.state);
        if (r.stats) setStats(r.stats);
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (s: ChannelState[]) => setStates(s));
    socket.on('stats', (s: Stats) => setStats(s));
    socket.on('comment', (c: Comment) => addComments([c], 'top'));
    socket.on('activity', (a: Activity) => setActivities((prev) => [a, ...prev].slice(0, 100)));
    socket.on('ended', () => void loadSession());
    socket.on('products', (p: SessionProduct[]) => setProducts(p));
    socket.on('order', (o: Order) => upsertOrder(o));
    socket.on('game', (g: Game) =>
      setGames((prev) => {
        const i = prev.findIndex((x) => x.id === g.id);
        if (i === -1) return [...prev, g].sort((a, b) => a.sortOrder - b.sortOrder);
        const next = prev.slice();
        next[i] = g;
        return next;
      }),
    );
    socket.on('gameAnswer', (p: { gameId: string; answer: GameAnswer; answersCount: number; correctCount: number }) => {
      setGameAnswers((prev) => ({ ...prev, [p.gameId]: [p.answer, ...(prev[p.gameId] ?? [])].slice(0, 100) }));
      setGames((prev) => prev.map((g) => (g.id === p.gameId ? { ...g, answersCount: p.answersCount, correctCount: p.correctCount } : g)));
    });
    socket.on('commentTag', (t: { key: string; tag: string; tagKind: Comment['tagKind'] }) =>
      setComments((prev) => prev.map((c) => (c.key === t.key ? { ...c, tag: t.tag, tagKind: t.tagKind } : c))),
    );
    return () => {
      socket.emit('leave', id);
      socket.close();
    };
  }, [id, addComments, loadSession, upsertOrder]);

  const loadMore = async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const r = await api<{ items: Comment[]; nextBefore: string | null }>(`/api/sessions/${id}/comments?limit=200&before=${nextBefore}`);
      addComments(r.items, 'bottom');
      setNextBefore(r.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  };

  const action = async (kind: 'start' | 'stop') => {
    if (kind === 'stop' && !confirm('Kết thúc phiên? Hệ thống sẽ ngừng ghi nhận bình luận.')) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/sessions/${id}/${kind}`, { method: 'POST' });
      await loadSession();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Xoá phiên live này và toàn bộ dữ liệu?')) return;
    try {
      await api(`/api/sessions/${id}`, { method: 'DELETE' });
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!session) return <p className="text-sm text-slate-500">{error || 'Đang tải…'}</p>;

  const running = session.status === 'RUNNING';
  const platforms = [...new Set(session.channels.map((c) => c.platform))] as Platform[];
  const stateOf = (channelId: string) => states.find((s) => s.channelId === channelId);

  return (
    <div className="space-y-4">
      {/* Đầu trang */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{session.title}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SESSION_STATUS[session.status].cls}`}>{SESSION_STATUS[session.status].label}</span>
            {running && !connected && <span className="text-xs text-amber-600">Mất kết nối realtime, đang thử lại…</span>}
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            {session.startedAt ? `Bắt đầu ${fmtDateTime(session.startedAt)} · ${fmtDuration(session.startedAt, session.endedAt)}` : 'Chưa bắt đầu'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {running ? (
            <button className="btn-danger" onClick={() => action('stop')} disabled={busy}>■ Kết thúc phiên</button>
          ) : (
            <button className="btn-primary" onClick={() => action('start')} disabled={busy}>
              ▶ {session.status === 'ENDED' ? 'Theo dõi tiếp' : 'Bắt đầu theo dõi'}
            </button>
          )}
          {session.status !== 'DRAFT' && (
            <a className="btn-ghost" href={`/api/sessions/${id}/export.xlsx`}>⬇ Xuất Excel</a>
          )}
          {!running && <button className="btn-ghost text-rose-600" onClick={remove}>Xoá</button>}
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* Tab */}
      <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
        {(
          [
            ['live', 'Theo dõi'],
            ['sales', `Bán hàng${products.length ? ` (${products.length})` : ''}`],
            ['orders', `Đơn hàng${orders.length ? ` (${orders.length})` : ''}`],
            ['games', `Game${games.some((g) => g.status === 'OPEN') ? ' ●' : games.length ? ` (${games.length})` : ''}`],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sales' && <SalesTab sessionId={id} products={products} onProductsChanged={loadProducts} />}
      {tab === 'orders' && <OrdersTab sessionId={id} orders={orders} products={products} />}
      {tab === 'games' && (
        <GamesTab sessionId={id} publicId={session.publicId} games={games} overlayGameId={overlayGameId} answers={gameAnswers} onReload={loadGames} />
      )}
      {tab === 'live' && (
      <>
      {/* Trạng thái từng kênh */}
      <div className="flex flex-wrap gap-2">
        {session.channels.map((c) => {
          const st = stateOf(c.id);
          return (
            <div key={c.id} className="card flex min-w-[220px] flex-1 items-center gap-2 px-3 py-2 sm:flex-none">
              <PlatformBadge platform={c.platform} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{c.name}</div>
                {running && st ? (
                  <>
                    <StatusDot status={st.status} />
                    {st.message && <div className="max-w-xs truncate text-xs text-slate-500" title={st.message}>{st.message}</div>}
                  </>
                ) : (
                  <div className="text-xs text-slate-500">Đỉnh {fmtNum(c.peakViewers)} người xem</div>
                )}
              </div>
              {running && st && st.status === 'live' && (
                <div className="ml-auto text-right">
                  <div className="text-sm font-semibold tabular-nums">{fmtNum(stats?.viewersByChannel[c.id] ?? st.viewers)}</div>
                  <div className="text-[11px] text-slate-500">đang xem</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {stats && <StatCards stats={stats} hasFacebook={platforms.includes('FACEBOOK')} />}

      <SellingBar sessionId={id} products={products} onChanged={loadProducts} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-4">
          <div className="card p-3">
            <h3 className="mb-1 text-sm font-semibold">Diễn biến theo phút</h3>
            <ActivityChart series={stats?.series ?? []} />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {stats && <TopUsers top={stats.top} />}
            <ActivityList items={activities} />
          </div>
        </div>
        <CommentFeed
          comments={comments}
          platforms={platforms}
          live={running}
          canLoadMore={!!nextBefore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          onCreateOrder={products.length ? setManualFor : undefined}
        />
      </div>
      </>
      )}
      {manualFor && <ManualOrder sessionId={id} comment={manualFor} products={products} onClose={() => setManualFor(null)} />}
    </div>
  );
}
