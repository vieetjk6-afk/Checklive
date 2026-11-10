import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { GAME_TYPE } from '../../lib/format';
import type { Game, GameType } from '../../lib/types';
import Modal from '../Modal';

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

/** Tạo / sửa 1 game trong kịch bản */
export default function GameForm({ sessionId, game, onClose }: { sessionId: string; game?: Game; onClose: () => void }) {
  const [type, setType] = useState<GameType>(game?.type ?? 'NUMBER_GUESS');
  const [title, setTitle] = useState(game?.title ?? '');
  const [question, setQuestion] = useState(game?.question ?? '');
  const [min, setMin] = useState(String(game?.config.min ?? 1));
  const [max, setMax] = useState(String(game?.config.max ?? 100));
  const [answer, setAnswer] = useState(game?.config.answer ?? '');
  const [answers, setAnswers] = useState((game?.config.answers ?? []).join('\n'));
  const [keyword, setKeyword] = useState(game?.config.keyword ?? '');
  const [accentInsensitive, setAccentInsensitive] = useState(game?.config.accentInsensitive !== false);
  const [winnersCount, setWinnersCount] = useState(String(game?.winnersCount ?? 1));
  const [prizes, setPrizes] = useState((game?.prizes ?? []).join('\n'));
  const [duration, setDuration] = useState(game?.durationSec ? String(game.durationSec) : '');
  const [like, setLike] = useState(!!game?.conditions.like);
  const [share, setShare] = useState(!!game?.conditions.share);
  const [follow, setFollow] = useState(!!game?.conditions.follow);
  const [fbPolicy, setFbPolicy] = useState(game?.conditions.facebookPolicy ?? 'skip');
  const [oneAttempt, setOneAttempt] = useState(game?.oneAttempt ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = !!game && game.status !== 'DRAFT';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const config =
      type === 'NUMBER_GUESS'
        ? { min: Number(min), max: Number(max) }
        : type === 'WORD_GUESS'
          ? { answer, accentInsensitive, revealed: game?.config.revealed ?? [] }
          : type === 'QUIZ'
            ? { answers: lines(answers), accentInsensitive }
            : { keyword };
    const body = {
      type,
      title: title || GAME_TYPE[type].label,
      question: question || null,
      config,
      winnersCount: Math.max(1, Number(winnersCount) || 1),
      prizes: lines(prizes),
      conditions: { like, share, follow, facebookPolicy: fbPolicy },
      oneAttempt,
      durationSec: duration ? Number(duration) : null,
    };
    try {
      if (game) await api(`/api/games/${game.id}`, { method: 'PUT', body });
      else await api(`/api/sessions/${sessionId}/games`, { method: 'POST', body });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={game ? `Sửa game: ${game.title}` : 'Thêm game vào kịch bản'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {!game && (
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(GAME_TYPE) as GameType[]).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setType(t)}
                className={`rounded-xl border p-2 text-left ${type === t ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200'}`}
              >
                <div className="text-sm font-semibold">{GAME_TYPE[t].icon} {GAME_TYPE[t].label}</div>
                <div className="text-[11px] text-slate-500">{GAME_TYPE[t].hint}</div>
              </button>
            ))}
          </div>
        )}
        <div>
          <label className="label" htmlFor="g-title">Tên game</label>
          <input id="g-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={GAME_TYPE[type].label} />
        </div>
        <div>
          <label className="label" htmlFor="g-q">{type === 'QUIZ' ? 'Câu hỏi' : 'Gợi ý / lời dẫn (hiện trên màn hình)'}</label>
          <textarea id="g-q" className="input" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} required={type === 'QUIZ'} />
        </div>

        {locked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Game đã mở nên không đổi được đáp án / khoảng số. Vẫn sửa được tên, giải thưởng, số người thắng.</p>}

        {type === 'NUMBER_GUESS' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="g-min">Từ số</label>
              <input id="g-min" className="input" type="number" value={min} onChange={(e) => setMin(e.target.value)} disabled={locked} />
            </div>
            <div>
              <label className="label" htmlFor="g-max">Đến số</label>
              <input id="g-max" className="input" type="number" value={max} onChange={(e) => setMax(e.target.value)} disabled={locked} />
            </div>
          </div>
        )}
        {type === 'WORD_GUESS' && (
          <div>
            <label className="label" htmlFor="g-ans">Từ / cụm từ cần đoán</label>
            <input id="g-ans" className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="VD: Con mèo" disabled={locked} required />
          </div>
        )}
        {type === 'QUIZ' && (
          <div>
            <label className="label" htmlFor="g-anss">Đáp án đúng (mỗi dòng 1 cách ghi được chấp nhận)</label>
            <textarea id="g-anss" className="input" rows={3} value={answers} onChange={(e) => setAnswers(e.target.value)} placeholder={'Hà Nội\nHN'} disabled={locked} required />
          </div>
        )}
        {(type === 'WORD_GUESS' || type === 'QUIZ') && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={accentInsensitive} onChange={(e) => setAccentInsensitive(e.target.checked)} disabled={locked} />
            Không phân biệt dấu (khách gõ "con meo" vẫn đúng)
          </label>
        )}
        {type === 'LUCKY_DRAW' && (
          <div>
            <label className="label" htmlFor="g-kw">Từ khoá tham gia (bỏ trống = mọi bình luận)</label>
            <input id="g-kw" className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="VD: tham gia" disabled={locked} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="g-n">Số người thắng</label>
            <input id="g-n" className="input" type="number" min={1} max={100} value={winnersCount} onChange={(e) => setWinnersCount(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="g-d">Tự khoá sau (giây)</label>
            <input id="g-d" className="input" type="number" min={5} max={3600} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="khoá bằng tay" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="g-p">Phần thưởng (mỗi dòng 1 giải theo thứ hạng; 1 dòng = mọi người thắng)</label>
          <textarea id="g-p" className="input" rows={2} value={prizes} onChange={(e) => setPrizes(e.target.value)} placeholder={'Voucher 100.000đ\nVoucher 50.000đ'} />
        </div>

        {type !== 'LUCKY_DRAW' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={oneAttempt} onChange={(e) => setOneAttempt(e.target.checked)} disabled={locked} />
            Mỗi người chỉ tính câu trả lời đầu tiên
          </label>
        )}

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="mb-1 text-sm font-semibold">Điều kiện để được nhận giải</div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={like} onChange={(e) => setLike(e.target.checked)} /> Đã thả tim</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Đã share</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Đã follow</label>
          </div>
          {(like || share || follow) && (
            <div className="mt-2 space-y-2 text-xs text-slate-600">
              <p>Chỉ TikTok kiểm tra được, và chỉ tính thao tác <b>trong buổi live</b> (người đã follow từ trước không được ghi nhận).</p>
              <label className="flex items-center gap-2">
                Người chơi Facebook:
                <select className="input w-auto py-1 text-xs" value={fbPolicy} onChange={(e) => setFbPolicy(e.target.value as 'skip' | 'exclude')}>
                  <option value="skip">Bỏ qua điều kiện (chỉ cần trả lời đúng)</option>
                  <option value="exclude">Không tính</option>
                </select>
              </label>
            </div>
          )}
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : game ? 'Lưu' : 'Thêm vào kịch bản'}</button>
        </div>
      </form>
    </Modal>
  );
}
