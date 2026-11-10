import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { papi } from '../../lib/publicApi';

interface OverlayGame {
  id: string;
  type: 'NUMBER_GUESS' | 'WORD_GUESS' | 'QUIZ' | 'LUCKY_DRAW';
  title: string;
  question: string | null;
  status: 'OPEN' | 'CLOSED' | 'SPINNING' | 'DONE';
  endsAt: string | null;
  revealAt: string | null;
  range: { min: number; max: number } | null;
  board: { ch: string | null; space: boolean }[] | null;
  answerText: string | null;
  keyword: string | null;
  result: string | null;
  answersCount: number;
  winnersCount: number;
  prizes: string[];
  winners: { rank: number; name: string; handle: string | null; avatarUrl: string | null; platform: string; prize: string | null }[];
}

const MEDAL = ['🥇', '🥈', '🥉'];

/**
 * Overlay game cho OBS / TikTok LIVE Studio (nền trong suốt).
 * Tham số: ?pos=bottom|top|center
 */
export default function GameOverlayPage() {
  const { publicId = '' } = useParams();
  const [params] = useSearchParams();
  const [game, setGame] = useState<OverlayGame | null>(null);
  const offset = useRef(0);
  const [now, setNow] = useState(Date.now());
  const [rolling, setRolling] = useState(0);

  useEffect(() => {
    document.body.style.background = 'transparent';
    document.body.classList.remove('bg-slate-50');
    let stop = false;
    const tick = async () => {
      try {
        const r = await papi<{ game: OverlayGame | null; now: number }>(`/api/public/s/${publicId}/game`);
        offset.current = r.now - Date.now();
        if (!stop) setGame(r.game);
      } catch {
        /* giữ dữ liệu cũ */
      }
      if (!stop) setTimeout(tick, 1000);
    };
    void tick();
    const clock = setInterval(() => setNow(Date.now() + offset.current), 200);
    return () => {
      stop = true;
      clearInterval(clock);
    };
  }, [publicId]);

  // Hiệu ứng quay số
  useEffect(() => {
    if (game?.status !== 'SPINNING') return;
    const t = setInterval(() => {
      const r = game.range;
      setRolling(r ? r.min + Math.floor(Math.random() * (r.max - r.min + 1)) : Math.floor(Math.random() * 1000));
    }, 70);
    return () => clearInterval(t);
  }, [game?.status, game?.range]);

  if (!game) return null;
  const pos = params.get('pos') ?? 'bottom';
  const place = pos === 'top' ? 'top-8' : pos === 'center' ? 'top-1/2 -translate-y-1/2' : 'bottom-8';
  const left = game.endsAt ? Math.max(0, Math.ceil((new Date(game.endsAt).getTime() - now) / 1000)) : null;
  const open = game.status === 'OPEN';
  const done = game.status === 'DONE';

  return (
    <div className={`fixed left-1/2 w-[760px] -translate-x-1/2 ${place}`} style={{ fontFamily: '"Be Vietnam Pro", sans-serif' }}>
      <div className="overflow-hidden rounded-3xl bg-white/95 shadow-2xl">
        <div className="flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-rose-500 px-5 py-3 text-white">
          <span className="text-2xl">{game.type === 'NUMBER_GUESS' ? '🎲' : game.type === 'WORD_GUESS' ? '🔤' : game.type === 'QUIZ' ? '❓' : '🎁'}</span>
          <div className="min-w-0 flex-1 text-xl font-extrabold">{game.title}</div>
          {left !== null && open && (
            <div className={`rounded-full bg-white/20 px-3 py-1 text-xl font-black tabular-nums ${left <= 5 ? 'animate-pulse' : ''}`}>⏱ {left}s</div>
          )}
        </div>

        <div className="space-y-4 px-6 py-5 text-center">
          {game.question && <div className="text-xl font-semibold text-slate-800">{game.question}</div>}

          {/* Đoán chữ: ô chữ */}
          {game.board && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {game.board.map((c, i) =>
                c.space ? (
                  <span key={i} className="w-5" />
                ) : (
                  <span
                    key={i}
                    className={`grid h-14 w-11 place-items-center rounded-lg text-3xl font-black ${c.ch ? 'bg-indigo-600 text-white' : 'border-2 border-dashed border-indigo-300 bg-indigo-50'}`}
                  >
                    {c.ch ?? ''}
                  </span>
                ),
              )}
            </div>
          )}

          {/* Đoán số */}
          {game.type === 'NUMBER_GUESS' && (
            <div>
              {open && game.range && (
                <div className="text-lg text-slate-700">
                  Bình luận <b>1 con số</b> từ <b>{game.range.min}</b> đến <b>{game.range.max}</b>
                </div>
              )}
              {game.status === 'CLOSED' && <div className="text-lg font-semibold text-amber-700">Đã khoá — chuẩn bị quay số!</div>}
              {game.status === 'SPINNING' && (
                <div className="text-8xl font-black tabular-nums text-indigo-700">{rolling}</div>
              )}
              {done && game.result && (
                <div>
                  <div className="text-sm font-semibold uppercase tracking-widest text-slate-500">Kết quả</div>
                  <div className="text-8xl font-black text-rose-600">{game.result}</div>
                </div>
              )}
            </div>
          )}

          {/* Quay thưởng */}
          {game.type === 'LUCKY_DRAW' && (
            <div>
              {open && (
                <div className="text-lg text-slate-700">
                  Bình luận {game.keyword ? <b>“{game.keyword}”</b> : 'bất kỳ'} để tham gia quay thưởng
                </div>
              )}
              {game.status === 'SPINNING' && <div className="animate-bounce text-7xl">🎁</div>}
              {game.status === 'CLOSED' && <div className="text-lg font-semibold text-amber-700">Đã khoá — chuẩn bị quay thưởng!</div>}
            </div>
          )}

          {(game.type === 'WORD_GUESS' || game.type === 'QUIZ') && open && (
            <div className="text-lg text-slate-700">Bình luận đáp án — <b>ai đúng sớm nhất thắng!</b></div>
          )}
          {(game.type === 'WORD_GUESS' || game.type === 'QUIZ') && game.status === 'CLOSED' && (
            <div className="text-lg font-semibold text-amber-700">Đã có người trả lời đúng! Đang kiểm tra…</div>
          )}
          {done && game.answerText && game.type === 'QUIZ' && (
            <div className="text-2xl font-bold text-emerald-700">Đáp án: {game.answerText}</div>
          )}

          {(open || game.status === 'CLOSED') && (
            <div className="flex justify-center gap-6 text-base text-slate-600">
              <span>👥 <b>{game.answersCount}</b> {game.type === 'LUCKY_DRAW' ? 'người tham gia' : 'lượt trả lời'}</span>
              {game.prizes.length > 0 && <span>🎁 {game.prizes.join(' · ')}</span>}
            </div>
          )}

          {/* Người thắng */}
          {done && (
            <div className="rounded-2xl bg-amber-50 p-4">
              <div className="mb-2 text-lg font-extrabold text-amber-800">🏆 Chúc mừng người thắng</div>
              {game.winners.length === 0 ? (
                <div className="text-slate-600">Chưa có ai {game.type === 'NUMBER_GUESS' ? 'đoán trúng' : 'thắng'} lần này 😢</div>
              ) : (
                <ol className="space-y-1.5">
                  {game.winners.slice(0, 10).map((w) => (
                    <li key={w.rank} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 text-left">
                      <span className="w-8 text-center text-2xl">{MEDAL[w.rank - 1] ?? w.rank}</span>
                      {w.avatarUrl ? (
                        <img src={w.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-700">{w.name.charAt(0).toUpperCase()}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-lg font-bold text-slate-900">{w.name}</div>
                        {w.handle && <div className="truncate text-sm text-slate-500">@{w.handle}</div>}
                      </div>
                      {w.prize && <span className="rounded-lg bg-rose-600 px-3 py-1 text-base font-bold text-white">{w.prize}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
