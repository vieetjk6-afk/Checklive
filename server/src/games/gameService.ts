import crypto from 'node:crypto';
import type { Game, GameAnswer, GameType, GameWinner, Platform, Prisma } from '@prisma/client';
import type { DB } from '../db.js';
import { boardOf, looksLikeNonAnswer, matchesAnswer, normalizeAnswer, parseGuessNumber, pickRevealIndex } from './matcher.js';

export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface GameConfig {
  /** Đoán số */
  min?: number;
  max?: number;
  /** Đoán chữ */
  answer?: string;
  revealed?: number[];
  /** Đố vui */
  answers?: string[];
  /** Quay số may mắn: từ khoá tham gia (rỗng = mọi bình luận) */
  keyword?: string;
  /** Không phân biệt dấu khi so đáp án (mặc định có) */
  accentInsensitive?: boolean;
}

export interface GameConditions {
  like?: boolean;
  share?: boolean;
  follow?: boolean;
  /** Facebook không cho biết ai like/share/follow: "skip" = bỏ qua điều kiện, "exclude" = không tính người chơi Facebook */
  facebookPolicy?: 'skip' | 'exclude';
}

export interface UserActivity {
  likes: number;
  shares: number;
  follows: number;
}

/** Tra cứu like/share/follow của 1 người trong phiên */
export type ActivityLookup = (sessionId: string, platform: Platform, platformUserId: string) => Promise<UserActivity | undefined>;

export interface GameNotifier {
  game(sessionId: string, game: GameDTO): void;
  answer(sessionId: string, payload: { gameId: string; answer: AnswerDTO; answersCount: number; correctCount: number }): void;
}

export interface CommentInput {
  platform: Platform;
  user?: { id: string; name?: string; handle?: string; avatarUrl?: string };
  content: string;
  platformTs: number;
  receivedAt: number;
}

/** Sau khi khoá, vẫn nhận câu trả lời gửi TRƯỚC lúc khoá nhưng đến muộn (Facebook trễ vài giây) */
export const GRACE_MS = 5000;
/** Thời gian hiệu ứng quay số trên màn hình */
export const SPIN_MS = 5000;

const cfgOf = (g: Game) => (g.config ?? {}) as GameConfig;
const condOf = (g: Game) => (g.conditions ?? {}) as GameConditions;
const userKey = (p: Platform, id: string) => `${p}|${id}`;

export function toAnswerDTO(a: GameAnswer) {
  return {
    id: a.id,
    platform: a.platform,
    platformUserId: a.platformUserId,
    userName: a.userName,
    userHandle: a.userHandle,
    avatarUrl: a.avatarUrl,
    content: a.content,
    value: a.value,
    correct: a.correct,
    platformTs: a.platformTs,
  };
}
export type AnswerDTO = ReturnType<typeof toAnswerDTO>;

export function toGameDTO(g: Game & { winners: GameWinner[] }, counts: { answers: number; correct: number }) {
  return {
    id: g.id,
    sessionId: g.sessionId,
    type: g.type,
    title: g.title,
    question: g.question,
    config: cfgOf(g),
    winnersCount: g.winnersCount,
    prizes: g.prizes,
    conditions: condOf(g),
    oneAttempt: g.oneAttempt,
    durationSec: g.durationSec,
    status: g.status,
    sortOrder: g.sortOrder,
    openedAt: g.openedAt,
    closedAt: g.closedAt,
    finishedAt: g.finishedAt,
    result: g.result,
    revealAt: g.revealAt,
    answersCount: counts.answers,
    correctCount: counts.correct,
    winners: g.winners
      .sort((a, b) => a.rank - b.rank)
      .map((w) => ({
        id: w.id, rank: w.rank, platform: w.platform, platformUserId: w.platformUserId, userName: w.userName, userHandle: w.userHandle,
        avatarUrl: w.avatarUrl, answer: w.answer, answeredAt: w.answeredAt, prize: w.prize, disqualified: w.disqualified,
      })),
  };
}
export type GameDTO = ReturnType<typeof toGameDTO>;

export interface GameInput {
  type: GameType;
  title: string;
  question?: string | null;
  config: GameConfig;
  winnersCount: number;
  prizes: string[];
  conditions: GameConditions;
  oneAttempt: boolean;
  durationSec?: number | null;
}

/** Kiểm tra cấu hình game hợp lệ, trả về cấu hình đã làm sạch */
export function validateGameInput(input: GameInput): GameConfig {
  const c = input.config ?? {};
  const accentInsensitive = c.accentInsensitive !== false;
  switch (input.type) {
    case 'NUMBER_GUESS': {
      const min = Math.round(Number(c.min ?? 1));
      const max = Math.round(Number(c.max ?? 100));
      if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 999_999 || min >= max) {
        throw new GameError('Khoảng số không hợp lệ (từ 0 đến 999999, số đầu nhỏ hơn số cuối)');
      }
      return { min, max };
    }
    case 'WORD_GUESS': {
      const answer = (c.answer ?? '').trim().replace(/\s+/g, ' ');
      if (!normalizeAnswer(answer)) throw new GameError('Nhập từ / cụm từ cần đoán');
      if (answer.length > 60) throw new GameError('Từ cần đoán tối đa 60 ký tự');
      const revealed = (c.revealed ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < Array.from(answer).length);
      return { answer, revealed, accentInsensitive };
    }
    case 'QUIZ': {
      const answers = (c.answers ?? []).map((a) => a.trim()).filter((a) => normalizeAnswer(a));
      if (answers.length === 0) throw new GameError('Nhập ít nhất 1 đáp án đúng');
      return { answers, accentInsensitive };
    }
    case 'LUCKY_DRAW':
      return { keyword: (c.keyword ?? '').trim() };
  }
}

interface ActiveGame {
  game: Game;
  answered: Set<string>;
  answersCount: number;
  correctCount: number;
}

/**
 * Game show trong lúc live: nhận câu trả lời từ bình luận, xếp hạng theo thời gian bình luận,
 * quay số / mở chữ / bốc thăm, kiểm tra điều kiện và trao giải.
 */
export class GameService {
  /** Game đang nhận câu trả lời của mỗi phiên (null = không có) */
  private active = new Map<string, ActiveGame | null>();
  private timers = new Map<string, NodeJS.Timeout[]>();

  constructor(
    private db: DB,
    private activity: ActivityLookup,
    private notify: GameNotifier = { game: () => {}, answer: () => {} },
  ) {}

  // ───────────── Hẹn giờ ─────────────

  private schedule(gameId: string, ms: number, fn: () => Promise<unknown>) {
    const t = setTimeout(() => {
      fn().catch((err) => console.error(`[game ${gameId}]`, err));
    }, Math.max(0, ms));
    const list = this.timers.get(gameId) ?? [];
    list.push(t);
    this.timers.set(gameId, list);
  }

  private clearTimers(gameId: string) {
    for (const t of this.timers.get(gameId) ?? []) clearTimeout(t);
    this.timers.delete(gameId);
  }

  shutdown() {
    for (const id of [...this.timers.keys()]) this.clearTimers(id);
  }

  /** Khởi động lại server: tiếp tục các hẹn giờ còn dở */
  async recover() {
    const games = await this.db.game.findMany({ where: { status: { in: ['OPEN', 'CLOSED'] } } });
    for (const g of games) {
      if (g.status === 'OPEN' && g.durationSec && g.openedAt) {
        const left = g.openedAt.getTime() + g.durationSec * 1000 - Date.now();
        this.schedule(g.id, left, () => this.close(g.id, null, true));
      }
      if (g.status === 'CLOSED' && g.revealAt) {
        this.schedule(g.id, g.revealAt.getTime() - Date.now(), () => this.finalize(g.id));
      } else if (g.status === 'CLOSED' && (g.type === 'WORD_GUESS' || g.type === 'QUIZ') && g.closedAt) {
        this.schedule(g.id, g.closedAt.getTime() + GRACE_MS - Date.now(), () => this.finalize(g.id));
      }
    }
  }

  // ───────────── Đọc ─────────────

  private async counts(gameId: string) {
    const [answers, correct] = await Promise.all([
      this.db.gameAnswer.count({ where: { gameId } }),
      this.db.gameAnswer.count({ where: { gameId, correct: true } }),
    ]);
    return { answers, correct };
  }

  async dto(gameId: string): Promise<GameDTO> {
    const g = await this.db.game.findUnique({ where: { id: gameId }, include: { winners: true } });
    if (!g) throw new GameError('Không tìm thấy game', 404);
    return toGameDTO(g, await this.counts(gameId));
  }

  async list(sessionId: string): Promise<GameDTO[]> {
    const games = await this.db.game.findMany({ where: { sessionId }, include: { winners: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const answerCounts = await this.db.gameAnswer.groupBy({ by: ['gameId', 'correct'], where: { game: { sessionId } }, _count: { _all: true } });
    return games.map((g) => {
      const rows = answerCounts.filter((r) => r.gameId === g.id);
      return toGameDTO(g, {
        answers: rows.reduce((s, r) => s + r._count._all, 0),
        correct: rows.find((r) => r.correct)?._count._all ?? 0,
      });
    });
  }

  async answers(gameId: string, opts: { correctOnly?: boolean; limit?: number } = {}): Promise<AnswerDTO[]> {
    const rows = await this.db.gameAnswer.findMany({
      where: { gameId, ...(opts.correctOnly ? { correct: true } : {}) },
      orderBy: opts.correctOnly ? [{ platformTs: 'asc' }, { receivedAt: 'asc' }] : [{ receivedAt: 'desc' }],
      take: Math.min(opts.limit ?? 100, 1000),
    });
    return rows.map(toAnswerDTO);
  }

  private async emit(gameId: string) {
    const dto = await this.dto(gameId);
    this.notify.game(dto.sessionId, dto);
    return dto;
  }

  async findForShop(gameId: string, shopId: string) {
    const g = await this.db.game.findFirst({ where: { id: gameId, session: { shopId } } });
    if (!g) throw new GameError('Không tìm thấy game', 404);
    return g;
  }

  // ───────────── Tạo / sửa ─────────────

  async create(sessionId: string, input: GameInput): Promise<GameDTO> {
    const config = validateGameInput(input);
    const last = await this.db.game.findFirst({ where: { sessionId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const g = await this.db.game.create({
      data: {
        sessionId,
        type: input.type,
        title: input.title.trim(),
        question: input.question?.trim() || null,
        config: config as Prisma.InputJsonValue,
        winnersCount: Math.min(100, Math.max(1, Math.round(input.winnersCount))),
        prizes: input.prizes.map((p) => p.trim()).filter(Boolean),
        conditions: input.conditions as Prisma.InputJsonValue,
        oneAttempt: input.oneAttempt,
        durationSec: input.durationSec || null,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    return this.emit(g.id);
  }

  async update(gameId: string, shopId: string, input: GameInput): Promise<GameDTO> {
    const g = await this.findForShop(gameId, shopId);
    if (input.type !== g.type) throw new GameError('Không đổi được loại game');
    const config = validateGameInput(input);
    // Đã mở thì không đổi đáp án / khoảng số (tránh gian lận), chỉ đổi tên, giải thưởng…
    const lockedConfig = g.status !== 'DRAFT';
    if (lockedConfig && g.type === 'WORD_GUESS') config.revealed = cfgOf(g).revealed ?? [];
    await this.db.game.update({
      where: { id: gameId },
      data: {
        title: input.title.trim(),
        question: input.question?.trim() || null,
        config: (lockedConfig ? cfgOf(g) : config) as Prisma.InputJsonValue,
        winnersCount: Math.min(100, Math.max(1, Math.round(input.winnersCount))),
        prizes: input.prizes.map((p) => p.trim()).filter(Boolean),
        conditions: input.conditions as Prisma.InputJsonValue,
        oneAttempt: lockedConfig ? g.oneAttempt : input.oneAttempt,
        durationSec: input.durationSec || null,
      },
    });
    this.active.delete(g.sessionId);
    return this.emit(gameId);
  }

  async remove(gameId: string, shopId: string) {
    const g = await this.findForShop(gameId, shopId);
    if (g.status === 'OPEN') throw new GameError('Hãy khoá game trước khi xoá');
    this.clearTimers(gameId);
    await this.db.game.delete({ where: { id: gameId } });
    await this.db.liveSession.updateMany({ where: { id: g.sessionId, overlayGameId: gameId }, data: { overlayGameId: null } });
    this.active.delete(g.sessionId);
  }

  // ───────────── Điều khiển ─────────────

  /** Mở game: bắt đầu nhận câu trả lời, hiện lên overlay */
  async open(gameId: string, shopId: string): Promise<GameDTO> {
    const g = await this.findForShop(gameId, shopId);
    const other = await this.db.game.findFirst({ where: { sessionId: g.sessionId, status: 'OPEN', NOT: { id: gameId } } });
    if (other) throw new GameError(`Game "${other.title}" đang mở. Hãy khoá game đó trước.`);
    if (g.status === 'OPEN') return this.dto(gameId);
    this.clearTimers(gameId);
    const reopening = g.status !== 'DRAFT';
    if (reopening && g.type === 'NUMBER_GUESS') {
      // Mở lại đoán số: xoá kết quả quay cũ
      await this.db.gameWinner.deleteMany({ where: { gameId } });
      await this.db.gameAnswer.updateMany({ where: { gameId }, data: { correct: false } });
    }
    const now = new Date();
    await this.db.game.update({
      where: { id: gameId },
      data: {
        status: 'OPEN',
        openedAt: reopening && g.openedAt ? g.openedAt : now,
        closedAt: null,
        finishedAt: null,
        revealAt: null,
        result: g.type === 'NUMBER_GUESS' ? null : g.result,
      },
    });
    await this.db.liveSession.update({ where: { id: g.sessionId }, data: { overlayGameId: gameId } });
    if (g.durationSec) this.schedule(gameId, g.durationSec * 1000, () => this.close(gameId, null, true));
    this.active.delete(g.sessionId);
    return this.emit(gameId);
  }

  /** Khoá: ngừng nhận câu trả lời mới. Đố vui / đoán chữ tự công bố sau vài giây. */
  async close(gameId: string, shopId: string | null, auto = false): Promise<GameDTO> {
    const g = shopId ? await this.findForShop(gameId, shopId) : await this.db.game.findUniqueOrThrow({ where: { id: gameId } });
    if (g.status !== 'OPEN') {
      if (auto) return this.dto(gameId);
      throw new GameError('Game không ở trạng thái đang mở');
    }
    this.clearTimers(gameId);
    const closedAt = new Date();
    await this.db.game.update({ where: { id: gameId }, data: { status: 'CLOSED', closedAt } });
    if (g.type === 'WORD_GUESS' || g.type === 'QUIZ') this.schedule(gameId, GRACE_MS, () => this.finalize(gameId));
    // Giữ game trong bộ nhớ để còn nhận câu trả lời đến muộn trong thời gian ân hạn
    const a = this.active.get(g.sessionId);
    if (a && a.game.id === gameId) a.game = { ...a.game, status: 'CLOSED', closedAt };
    this.schedule(gameId, GRACE_MS + 50, async () => {
      const cur = this.active.get(g.sessionId);
      if (cur && cur.game.id === gameId && cur.game.status !== 'OPEN') this.active.delete(g.sessionId);
    });
    return this.emit(gameId);
  }

  /** Đoán số: quay ra kết quả (ngẫu nhiên hoặc nhập tay), công bố sau hiệu ứng quay */
  async spin(gameId: string, shopId: string, manual?: number): Promise<GameDTO> {
    const g = await this.findForShop(gameId, shopId);
    if (g.type !== 'NUMBER_GUESS') throw new GameError('Chỉ dùng cho game đoán số');
    if (g.status === 'DRAFT') throw new GameError('Game chưa mở');
    if (g.status === 'CLOSED' && g.revealAt && g.revealAt > new Date()) throw new GameError('Đang quay, chờ chút');
    if (g.status === 'OPEN') await this.close(gameId, shopId);
    const { min = 1, max = 100 } = cfgOf(g);
    let result: number;
    if (manual !== undefined && manual !== null) {
      if (!Number.isInteger(manual) || manual < min || manual > max) throw new GameError(`Kết quả phải trong khoảng ${min}–${max}`);
      result = manual;
    } else {
      result = crypto.randomInt(min, max + 1);
    }
    const fresh = await this.db.game.findUniqueOrThrow({ where: { id: gameId } });
    const graceEnd = (fresh.closedAt?.getTime() ?? Date.now()) + GRACE_MS;
    const revealAt = new Date(Math.max(Date.now() + SPIN_MS, graceEnd));
    this.clearTimers(gameId);
    await this.db.gameWinner.deleteMany({ where: { gameId } });
    await this.db.game.update({ where: { id: gameId }, data: { status: 'CLOSED', result: String(result), revealAt, finishedAt: null } });
    this.schedule(gameId, revealAt.getTime() - Date.now(), () => this.finalize(gameId));
    return this.emit(gameId);
  }

  /** Quay số may mắn: bốc thăm người thắng, công bố sau hiệu ứng */
  async draw(gameId: string, shopId: string): Promise<GameDTO> {
    const g = await this.findForShop(gameId, shopId);
    if (g.type !== 'LUCKY_DRAW') throw new GameError('Chỉ dùng cho quay số may mắn');
    if (g.status === 'DRAFT') throw new GameError('Game chưa mở');
    if (g.status === 'OPEN') await this.close(gameId, shopId);
    const fresh = await this.db.game.findUniqueOrThrow({ where: { id: gameId } });
    const revealAt = new Date(Math.max(Date.now() + SPIN_MS, (fresh.closedAt?.getTime() ?? Date.now()) + GRACE_MS));
    this.clearTimers(gameId);
    await this.db.gameWinner.deleteMany({ where: { gameId } });
    await this.db.game.update({ where: { id: gameId }, data: { status: 'CLOSED', revealAt, finishedAt: null } });
    this.schedule(gameId, revealAt.getTime() - Date.now(), () => this.finalize(gameId));
    return this.emit(gameId);
  }

  /** Đoán chữ: mở thêm 1 chữ (ngẫu nhiên hoặc theo vị trí) */
  async reveal(gameId: string, shopId: string, index?: number): Promise<GameDTO> {
    const g = await this.findForShop(gameId, shopId);
    if (g.type !== 'WORD_GUESS') throw new GameError('Chỉ dùng cho game đoán chữ');
    const cfg = cfgOf(g);
    const revealed = [...(cfg.revealed ?? [])];
    const idx = index ?? pickRevealIndex(cfg.answer ?? '', revealed, () => crypto.randomInt(1_000_000) / 1_000_000);
    if (idx === undefined) throw new GameError('Đã mở hết chữ');
    if (!revealed.includes(idx)) revealed.push(idx);
    await this.db.game.update({ where: { id: gameId }, data: { config: { ...cfg, revealed } as Prisma.InputJsonValue } });
    const a = this.active.get(g.sessionId);
    if (a && a.game.id === gameId) a.game = { ...a.game, config: { ...cfg, revealed } as Prisma.JsonValue };
    return this.emit(gameId);
  }

  async setOverlay(sessionId: string, gameId: string | null) {
    await this.db.liveSession.update({ where: { id: sessionId }, data: { overlayGameId: gameId } });
  }

  // ───────────── Nhận câu trả lời ─────────────

  private async activeGame(sessionId: string): Promise<ActiveGame | null> {
    if (this.active.has(sessionId)) return this.active.get(sessionId)!;
    const game = await this.db.game.findFirst({
      where: {
        sessionId,
        OR: [{ status: 'OPEN' }, { status: 'CLOSED', closedAt: { gt: new Date(Date.now() - GRACE_MS) } }],
      },
      orderBy: { openedAt: 'desc' },
    });
    if (!game) {
      this.active.set(sessionId, null);
      return null;
    }
    const rows = await this.db.gameAnswer.findMany({ where: { gameId: game.id }, select: { platform: true, platformUserId: true, correct: true } });
    const a: ActiveGame = {
      game,
      answered: new Set(rows.map((r) => userKey(r.platform, r.platformUserId))),
      answersCount: rows.length,
      correctCount: rows.filter((r) => r.correct).length,
    };
    this.active.set(sessionId, a);
    return a;
  }

  /** Xử lý 1 bình luận. Phải gọi tuần tự theo thứ tự bình luận đến. */
  async handleComment(sessionId: string, c: CommentInput): Promise<void> {
    if (!c.user) return;
    const a = await this.activeGame(sessionId);
    if (!a) return;
    const g = a.game;
    const opened = g.openedAt?.getTime() ?? 0;
    // Bình luận gửi trước lúc mở game không tính (cho phép lệch 1 giây vì Facebook làm tròn giây)
    if (c.platformTs < opened - 1000) return;
    if (g.status !== 'OPEN') {
      const closed = g.closedAt?.getTime() ?? 0;
      if (g.status !== 'CLOSED' || c.platformTs > closed || c.receivedAt > closed + GRACE_MS) return;
    }
    const key = userKey(c.platform, c.user.id);
    if (a.answered.has(key)) return;

    const cfg = cfgOf(g);
    let value: string | null = null;
    let correct = false;
    switch (g.type) {
      case 'NUMBER_GUESS': {
        const n = parseGuessNumber(c.content, cfg.min ?? 1, cfg.max ?? 100);
        if (n === undefined) return; // không có số hợp lệ: chưa tính là đã trả lời
        value = String(n);
        break;
      }
      case 'WORD_GUESS':
      case 'QUIZ': {
        const answers = g.type === 'WORD_GUESS' ? [cfg.answer ?? ''] : cfg.answers ?? [];
        correct = matchesAnswer(c.content, answers, cfg.accentInsensitive !== false);
        // Cho trả lời nhiều lần: chỉ lưu khi đúng
        if (!g.oneAttempt && !correct) return;
        // Bình luận hỏi hàng / chốt đơn / SĐT… không tính là đã trả lời (không mất lượt)
        if (!correct && looksLikeNonAnswer(c.content, answers)) return;
        value = normalizeAnswer(c.content, cfg.accentInsensitive !== false).slice(0, 200);
        break;
      }
      case 'LUCKY_DRAW': {
        const kw = (cfg.keyword ?? '').trim();
        if (kw && !matchesAnswer(c.content, [kw])) return;
        correct = true;
        break;
      }
    }

    a.answered.add(key);
    const row = await this.db.gameAnswer.create({
      data: {
        gameId: g.id,
        platform: c.platform,
        platformUserId: c.user.id,
        userName: c.user.name ?? null,
        userHandle: c.user.handle ?? null,
        avatarUrl: c.user.avatarUrl ?? null,
        content: c.content.slice(0, 500),
        value,
        correct,
        platformTs: new Date(c.platformTs),
        receivedAt: new Date(c.receivedAt),
      },
    });
    a.answersCount++;
    if (correct) a.correctCount++;
    this.notify.answer(sessionId, { gameId: g.id, answer: toAnswerDTO(row), answersCount: a.answersCount, correctCount: a.correctCount });

    // Đoán chữ / đố vui: đủ số người đúng thì tự khoá (rồi công bố sau thời gian ân hạn)
    if (correct && (g.type === 'WORD_GUESS' || g.type === 'QUIZ') && g.status === 'OPEN' && a.correctCount >= g.winnersCount) {
      await this.close(g.id, null, true);
    }
  }

  // ───────────── Công bố kết quả ─────────────

  private async eligible(g: Game, platform: Platform, userId: string): Promise<boolean> {
    const cond = condOf(g);
    if (!cond.like && !cond.share && !cond.follow) return true;
    if (platform === 'FACEBOOK') return (cond.facebookPolicy ?? 'skip') === 'skip';
    const act = await this.activity(g.sessionId, platform, userId);
    if (!act) return false;
    if (cond.like && act.likes <= 0) return false;
    if (cond.share && act.shares <= 0) return false;
    if (cond.follow && act.follows <= 0) return false;
    return true;
  }

  /** Danh sách ứng viên theo thứ tự ưu tiên */
  private async candidates(g: Game): Promise<GameAnswer[]> {
    const order: Prisma.GameAnswerOrderByWithRelationInput[] = [{ platformTs: 'asc' }, { receivedAt: 'asc' }, { createdAt: 'asc' }];
    if (g.type === 'NUMBER_GUESS') {
      if (g.result === null) return [];
      return this.db.gameAnswer.findMany({ where: { gameId: g.id, value: g.result }, orderBy: order });
    }
    const rows = await this.db.gameAnswer.findMany({ where: { gameId: g.id, correct: true }, orderBy: order });
    if (g.type === 'LUCKY_DRAW') {
      // Xáo trộn ngẫu nhiên (Fisher–Yates với số ngẫu nhiên an toàn)
      for (let i = rows.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [rows[i], rows[j]] = [rows[j], rows[i]];
      }
    }
    return rows;
  }

  /**
   * Chọn người thắng. mode "fresh": làm lại từ đầu; "fill": giữ người thắng hiện tại, bổ sung chỗ trống
   * (sau khi loại 1 người).
   */
  async finalize(gameId: string, mode: 'fresh' | 'fill' = 'fresh'): Promise<GameDTO> {
    this.clearTimers(gameId);
    const g = await this.db.game.findUniqueOrThrow({ where: { id: gameId }, include: { winners: true } });
    if (g.type === 'NUMBER_GUESS' && g.result !== null) {
      await this.db.gameAnswer.updateMany({ where: { gameId }, data: { correct: false } });
      await this.db.gameAnswer.updateMany({ where: { gameId, value: g.result }, data: { correct: true } });
    }
    const disqualified = new Set(g.winners.filter((w) => w.disqualified).map((w) => userKey(w.platform, w.platformUserId)));
    const kept = mode === 'fill' ? g.winners.filter((w) => !w.disqualified).sort((a, b) => a.rank - b.rank) : [];
    const taken = new Set(kept.map((w) => userKey(w.platform, w.platformUserId)));
    const picked: GameAnswer[] = [];
    for (const cand of await this.candidates(g)) {
      if (kept.length + picked.length >= g.winnersCount) break;
      const k = userKey(cand.platform, cand.platformUserId);
      if (disqualified.has(k) || taken.has(k)) continue;
      if (!(await this.eligible(g, cand.platform, cand.platformUserId))) continue;
      taken.add(k);
      picked.push(cand);
    }
    const prizeFor = (rank: number) => (g.prizes.length ? g.prizes[Math.min(rank, g.prizes.length) - 1] : null);
    await this.db.$transaction(async (tx) => {
      if (mode === 'fresh') await tx.gameWinner.deleteMany({ where: { gameId, disqualified: false } });
      let rank = 0;
      for (const w of kept) {
        rank++;
        await tx.gameWinner.update({ where: { id: w.id }, data: { rank, prize: prizeFor(rank) } });
      }
      for (const p of picked) {
        rank++;
        await tx.gameWinner.create({
          data: {
            gameId, rank, platform: p.platform, platformUserId: p.platformUserId, userName: p.userName, userHandle: p.userHandle,
            avatarUrl: p.avatarUrl, answer: p.content, answeredAt: p.platformTs, prize: prizeFor(rank),
          },
        });
      }
      await tx.game.update({
        where: { id: gameId },
        data: { status: 'DONE', finishedAt: g.finishedAt ?? new Date(), revealAt: g.revealAt ?? new Date(), closedAt: g.closedAt ?? new Date() },
      });
    });
    const a = this.active.get(g.sessionId);
    if (a && a.game.id === gameId) this.active.delete(g.sessionId);
    return this.emit(gameId);
  }

  /** Loại 1 người thắng (không hợp lệ) và bổ sung người kế tiếp */
  async disqualify(winnerId: string, shopId: string): Promise<GameDTO> {
    const w = await this.db.gameWinner.findFirst({ where: { id: winnerId, game: { session: { shopId } } }, include: { game: true } });
    if (!w) throw new GameError('Không tìm thấy người thắng', 404);
    if (w.game.status !== 'DONE') throw new GameError('Game chưa có kết quả');
    await this.db.gameWinner.update({ where: { id: winnerId }, data: { disqualified: true, rank: 1000 + w.rank } });
    return this.finalize(w.gameId, 'fill');
  }

  /** Dữ liệu hiển thị trên overlay (không lộ đáp án / kết quả trước giờ công bố) */
  async overlay(sessionId: string) {
    const s = await this.db.liveSession.findUnique({ where: { id: sessionId }, select: { overlayGameId: true } });
    if (!s?.overlayGameId) return null;
    const g = await this.db.game.findUnique({ where: { id: s.overlayGameId }, include: { winners: { where: { disqualified: false }, orderBy: { rank: 'asc' } } } });
    if (!g || g.status === 'DRAFT') return null;
    const cfg = cfgOf(g);
    const now = Date.now();
    const revealed = g.status === 'DONE';
    const spinning = g.status === 'CLOSED' && !!g.revealAt && g.revealAt.getTime() > now;
    const counts = await this.counts(g.id);
    return {
      id: g.id,
      type: g.type,
      title: g.title,
      question: g.question,
      status: spinning ? 'SPINNING' : g.status,
      endsAt: g.status === 'OPEN' && g.durationSec && g.openedAt ? new Date(g.openedAt.getTime() + g.durationSec * 1000) : null,
      revealAt: g.revealAt,
      range: g.type === 'NUMBER_GUESS' ? { min: cfg.min ?? 1, max: cfg.max ?? 100 } : null,
      board: g.type === 'WORD_GUESS' ? boardOf(cfg.answer ?? '', cfg.revealed ?? [], revealed) : null,
      answerText: revealed ? (g.type === 'WORD_GUESS' ? cfg.answer : g.type === 'QUIZ' ? cfg.answers?.[0] : null) : null,
      keyword: g.type === 'LUCKY_DRAW' ? cfg.keyword || null : null,
      result: revealed ? g.result : null,
      answersCount: counts.answers,
      winnersCount: g.winnersCount,
      prizes: g.prizes,
      winners: revealed
        ? g.winners.map((w) => ({ rank: w.rank, name: w.userName ?? w.userHandle ?? 'Ẩn danh', handle: w.userHandle, avatarUrl: w.avatarUrl, platform: w.platform, prize: w.prize }))
        : [],
    };
  }
}
