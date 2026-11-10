import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { GAME_STATUS, GAME_TYPE, fmtTime } from '../../lib/format';
import type { Game, GameAnswer } from '../../lib/types';
import { Avatar, Empty, PlatformBadge } from '../ui';
import GameForm from './GameForm';

const isLetter = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/** Đồng hồ đếm ngược tới 1 thời điểm */
function useCountdown(until: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : null;
}

/** Ô chữ trong màn hình điều khiển: bấm vào ô để mở chữ đó */
function AdminBoard({ game, onReveal }: { game: Game; onReveal: (i: number) => void }) {
  const answer = game.config.answer ?? '';
  const revealed = new Set(game.config.revealed ?? []);
  const done = game.status === 'DONE';
  return (
    <div className="flex flex-wrap gap-1">
      {Array.from(answer).map((ch, i) =>
        /\s/.test(ch) ? (
          <span key={i} className="w-3" />
        ) : !isLetter(ch) ? (
          <span key={i} className="grid h-10 w-8 place-items-center text-lg font-bold">{ch}</span>
        ) : (
          <button
            key={i}
            onClick={() => !revealed.has(i) && !done && onReveal(i)}
            title={revealed.has(i) ? 'Đã mở' : 'Bấm để mở chữ này'}
            className={`grid h-10 w-8 place-items-center rounded-md border-2 text-lg font-bold ${
              revealed.has(i) || done ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-dashed border-slate-300 text-slate-300 hover:border-indigo-400'
            }`}
          >
            {ch.toUpperCase()}
          </button>
        ),
      )}
    </div>
  );
}

function ControlPanel({
  game,
  liveAnswers,
  overlayGameId,
  onEdit,
  onReload,
}: {
  game: Game;
  liveAnswers: GameAnswer[];
  overlayGameId: string | null;
  onEdit: () => void;
  onReload: () => void;
}) {
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [initial, setInitial] = useState<GameAnswer[]>([]);
  useEffect(() => {
    api<GameAnswer[]>(`/api/games/${game.id}/answers?limit=100`).then(setInitial).catch(() => undefined);
  }, [game.id]);
  const seenIds = new Set<string>();
  const answers = [...liveAnswers, ...initial].filter((a) => (seenIds.has(a.id) ? false : (seenIds.add(a.id), true))).slice(0, 100);
  const endsAt = game.status === 'OPEN' && game.durationSec && game.openedAt ? new Date(game.openedAt).getTime() + game.durationSec * 1000 : null;
  const left = useCountdown(endsAt);
  const revealAt = game.status === 'CLOSED' && game.revealAt ? new Date(game.revealAt).getTime() : null;
  const revealIn = useCountdown(revealAt);

  const run = async (action: string, body?: unknown) => {
    setBusy(true);
    try {
      await api(`/api/games/${game.id}/${action}`, { method: 'POST', body });
      onReload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disqualify = async (wid: string) => {
    if (!confirm('Loại người này (không hợp lệ)? Người kế tiếp sẽ được lên thay.')) return;
    await api(`/api/game-winners/${wid}/disqualify`, { method: 'POST' }).catch((e) => alert(e.message));
  };

  const t = game.type;
  const st = GAME_STATUS[game.status];
  const shown = overlayGameId === game.id;
  const winners = game.winners.filter((w) => !w.disqualified);
  const out = game.winners.filter((w) => w.disqualified);

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-500">{GAME_TYPE[t].icon} {GAME_TYPE[t].label}</div>
          <h3 className="text-lg font-bold">{game.title}</h3>
          {game.question && <p className="text-sm text-slate-600">{game.question}</p>}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        {t === 'NUMBER_GUESS' && <span>Khoảng số: <b>{game.config.min}–{game.config.max}</b></span>}
        {t === 'QUIZ' && <span>Đáp án: <b>{(game.config.answers ?? []).join(' / ')}</b></span>}
        {t === 'LUCKY_DRAW' && <span>Từ khoá: <b>{game.config.keyword || 'mọi bình luận'}</b></span>}
        <span>{t === 'LUCKY_DRAW' ? 'Người tham gia' : 'Câu trả lời'}: <b>{game.answersCount}</b></span>
        {(t === 'WORD_GUESS' || t === 'QUIZ') && <span>Trả lời đúng: <b className="text-emerald-700">{game.correctCount}</b></span>}
        <span>Số người thắng: <b>{game.winnersCount}</b></span>
        {left !== null && <span className="font-semibold text-rose-600">⏱ còn {left}s</span>}
      </div>

      {t === 'WORD_GUESS' && <AdminBoard game={game} onReveal={(i) => run('reveal', { index: i })} />}

      {t === 'NUMBER_GUESS' && game.result && (
        <div className="text-center">
          <div className="text-xs text-slate-500">Kết quả</div>
          <div className="text-5xl font-black text-indigo-700">{game.result}</div>
          {revealIn !== null && revealIn > 0 && <div className="text-sm text-amber-700">Đang quay trên màn hình… công bố sau {revealIn}s</div>}
        </div>
      )}
      {t === 'LUCKY_DRAW' && revealIn !== null && revealIn > 0 && <div className="text-center text-sm text-amber-700">🎁 Đang quay thưởng… công bố sau {revealIn}s</div>}
      {(t === 'WORD_GUESS' || t === 'QUIZ') && game.status === 'CLOSED' && !game.revealAt && (
        <div className="text-center text-sm text-amber-700">Đang chờ vài giây để nhận câu trả lời đến muộn, sau đó tự công bố…</div>
      )}

      {/* Nút điều khiển */}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        {game.status === 'DRAFT' && <button className="btn-primary" disabled={busy} onClick={() => run('open')}>▶ Mở game</button>}
        {game.status === 'OPEN' && t !== 'NUMBER_GUESS' && t !== 'LUCKY_DRAW' && (
          <button className="btn-ghost" disabled={busy} onClick={() => run('close')}>■ Khoá & công bố</button>
        )}
        {game.status === 'OPEN' && (t === 'NUMBER_GUESS' || t === 'LUCKY_DRAW') && (
          <button className="btn-ghost" disabled={busy} onClick={() => run('close')}>■ Khoá trả lời</button>
        )}
        {t === 'NUMBER_GUESS' && game.status !== 'DRAFT' && (
          <>
            <button className="btn-primary" disabled={busy || (revealIn ?? 0) > 0} onClick={() => run('spin')}>
              🎲 {game.status === 'DONE' ? 'Quay lại' : 'Quay số ngẫu nhiên'}
            </button>
            <div className="flex items-center gap-1">
              <input className="input w-24 py-1.5" type="number" placeholder="Số" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Nhập kết quả" />
              <button className="btn-ghost" disabled={busy || manual === '' || (revealIn ?? 0) > 0} onClick={() => run('spin', { result: Number(manual) })}>
                Công bố số này
              </button>
            </div>
          </>
        )}
        {t === 'LUCKY_DRAW' && game.status !== 'DRAFT' && (
          <button className="btn-primary" disabled={busy || (revealIn ?? 0) > 0} onClick={() => run('draw')}>
            🎁 {game.status === 'DONE' ? 'Quay lại' : 'Quay thưởng'}
          </button>
        )}
        {t === 'WORD_GUESS' && game.status === 'OPEN' && <button className="btn-ghost" disabled={busy} onClick={() => run('reveal')}>Mở 1 chữ ngẫu nhiên</button>}
        {(t === 'WORD_GUESS' || t === 'QUIZ') && game.status === 'CLOSED' && <button className="btn-primary" disabled={busy} onClick={() => run('finalize')}>Công bố ngay</button>}
        {(game.status === 'CLOSED' || game.status === 'DONE') && <button className="btn-ghost" disabled={busy} onClick={() => run('open')}>↺ Mở lại</button>}
        {game.status !== 'DRAFT' && (
          <button className="btn-ghost" onClick={() => run(shown ? 'hide' : 'show')}>{shown ? '🙈 Ẩn khỏi màn hình' : '📺 Hiện lên màn hình'}</button>
        )}
        <button className="btn-ghost ml-auto" onClick={onEdit}>Sửa</button>
      </div>

      {/* Người thắng */}
      {game.status === 'DONE' && (
        <div>
          <h4 className="mb-1 text-sm font-semibold">🏆 Người thắng</h4>
          {winners.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
              Không có ai {t === 'NUMBER_GUESS' ? 'đoán trúng' : t === 'LUCKY_DRAW' ? 'đủ điều kiện' : 'trả lời đúng'}.
            </p>
          ) : (
            <ol className="space-y-1">
              {winners.map((w) => (
                <li key={w.id} className="flex items-center gap-2 rounded-lg bg-emerald-50/60 px-2 py-1.5 text-sm">
                  <span className="w-6 text-center font-bold">{w.rank <= 3 ? ['🥇', '🥈', '🥉'][w.rank - 1] : w.rank}</span>
                  <Avatar name={w.userName ?? undefined} url={w.avatarUrl ?? undefined} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{w.userName ?? w.userHandle}</div>
                    <div className="truncate text-xs text-slate-500">
                      {w.userHandle && `@${w.userHandle} · `}“{w.answer}” lúc {fmtTime(w.answeredAt)}
                    </div>
                  </div>
                  <PlatformBadge platform={w.platform} short />
                  {w.prize && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">{w.prize}</span>}
                  <button className="text-xs text-rose-600 hover:underline" onClick={() => disqualify(w.id)}>Loại</button>
                </li>
              ))}
            </ol>
          )}
          {out.length > 0 && <p className="mt-1 text-xs text-slate-500">Đã loại: {out.map((w) => w.userName ?? w.userHandle).join(', ')}</p>}
        </div>
      )}

      {/* Câu trả lời mới nhất */}
      <div>
        <h4 className="mb-1 text-sm font-semibold">{t === 'LUCKY_DRAW' ? 'Người tham gia mới nhất' : 'Câu trả lời mới nhất'}</h4>
        {answers.length === 0 ? (
          <p className="text-xs text-slate-400">{game.status === 'DRAFT' ? 'Mở game để bắt đầu nhận câu trả lời' : 'Chưa có'}</p>
        ) : (
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {answers.map((a) => (
              <li key={a.id} className={`flex items-center gap-2 py-1 text-sm ${a.correct && t !== 'LUCKY_DRAW' ? 'bg-emerald-50' : ''}`}>
                <PlatformBadge platform={a.platform} short />
                <span className="w-32 shrink-0 truncate font-medium">{a.userName ?? a.userHandle}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{t === 'NUMBER_GUESS' ? <b>{a.value}</b> : a.content}</span>
                {a.correct && t !== 'LUCKY_DRAW' && <span className="text-xs font-semibold text-emerald-700">✓</span>}
                <span className="shrink-0 text-xs tabular-nums text-slate-400">{fmtTime(a.platformTs)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function GamesTab({
  sessionId,
  publicId,
  games,
  overlayGameId,
  answers,
  onReload,
}: {
  sessionId: string;
  publicId: string;
  games: Game[];
  overlayGameId: string | null;
  answers: Record<string, GameAnswer[]>;
  onReload: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Game | 'new' | null>(null);
  const open = games.find((g) => g.status === 'OPEN' || (g.status === 'CLOSED' && g.revealAt));
  const selected = games.find((g) => g.id === selectedId) ?? open ?? games.find((g) => g.id === overlayGameId) ?? games[0];
  const overlay = `${window.location.origin}/overlay/${publicId}/game`;

  const remove = async (g: Game) => {
    if (!confirm(`Xoá game "${g.title}"?`)) return;
    await api(`/api/games/${g.id}`, { method: 'DELETE' }).catch((e) => alert(e.message));
    onReload();
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Kịch bản game</h3>
          <button className="btn-primary px-2 py-1.5 text-xs" onClick={() => setEditing('new')}>+ Thêm game</button>
        </div>
        {games.length === 0 ? (
          <Empty>Chưa có game. Soạn sẵn các game trước buổi live, khi live chỉ cần bấm Mở.</Empty>
        ) : (
          <ol className="space-y-2">
            {games.map((g, i) => (
              <li key={g.id}>
                <button
                  onClick={() => setSelectedId(g.id)}
                  className={`card w-full p-3 text-left ${selected?.id === g.id ? 'border-indigo-400 ring-2 ring-indigo-100' : 'hover:border-indigo-200'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400">{i + 1}</span>
                    <span>{GAME_TYPE[g.type].icon}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{g.title}</span>
                    {overlayGameId === g.id && <span title="Đang hiện trên màn hình">📺</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span className={`rounded-full px-1.5 py-0.5 font-medium ${GAME_STATUS[g.status].cls}`}>{GAME_STATUS[g.status].label}</span>
                    <span>{g.answersCount} trả lời</span>
                    {g.prizes[0] && <span className="truncate">🎁 {g.prizes[0]}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="card space-y-1 p-3 text-xs">
          <div className="font-medium text-slate-700">Overlay game cho OBS / TikTok LIVE Studio</div>
          <p className="text-slate-500">Thêm nguồn "Browser" với link này. Game đang mở sẽ tự hiện.</p>
          <div className="flex gap-1">
            <a className="btn-ghost px-2 py-1 text-xs" href={overlay} target="_blank" rel="noreferrer">Xem thử</a>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => navigator.clipboard?.writeText(overlay)}>Sao chép link</button>
            <a className="btn-ghost ml-auto px-2 py-1 text-xs" href={`/api/sessions/${sessionId}/games/export.xlsx`}>⬇ Excel kết quả</a>
          </div>
        </div>
      </div>

      <div className="min-w-0">
        {selected ? (
          <>
            <ControlPanel
              key={selected.id}
              game={selected}
              liveAnswers={answers[selected.id] ?? []}
              overlayGameId={overlayGameId}
              onEdit={() => setEditing(selected)}
              onReload={onReload}
            />
            {selected.status !== 'OPEN' && (
              <button className="mt-2 text-xs text-rose-600 hover:underline" onClick={() => remove(selected)}>Xoá game này</button>
            )}
          </>
        ) : (
          <Empty>Chọn hoặc thêm 1 game để điều khiển</Empty>
        )}
      </div>

      {editing && (
        <GameForm
          sessionId={sessionId}
          game={editing === 'new' ? undefined : editing}
          onClose={() => {
            setEditing(null);
            onReload();
          }}
        />
      )}
    </div>
  );
}
