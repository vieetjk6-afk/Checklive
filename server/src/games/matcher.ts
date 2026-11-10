import { extractPhones, stripDiacritics } from '../core/text.js';
import { isQuestion } from '../sales/parser.js';

/** Chuẩn hoá câu trả lời: chữ thường, (bỏ dấu), bỏ ký tự đặc biệt, gộp khoảng trắng */
export function normalizeAnswer(text: string, accentInsensitive = true): string {
  let s = text.toLowerCase().normalize('NFC');
  if (accentInsensitive) s = stripDiacritics(s);
  return s
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bình luận có chứa đáp án đúng không ("con mèo", "đáp án là con mèo ạ", "conmeo") */
export function matchesAnswer(comment: string, answers: string[], accentInsensitive = true): boolean {
  const c = normalizeAnswer(comment, accentInsensitive);
  if (!c) return false;
  for (const a of answers) {
    const na = normalizeAnswer(a, accentInsensitive);
    if (!na) continue;
    if (` ${c} `.includes(` ${na} `)) return true;
    if (c.replace(/ /g, '') === na.replace(/ /g, '')) return true;
  }
  return false;
}

/**
 * Đọc số khách đoán: số đầu tiên đứng riêng (không dính chữ như "A1") nằm trong khoảng [min, max].
 * Bỏ qua số điện thoại.
 */
export function parseGuessNumber(text: string, min: number, max: number): number | undefined {
  const cleaned = text.replace(/(?:\+?84|0)(?:[\s.\-]?\d){9}(?!\d)/g, ' ');
  for (const tok of cleaned.split(/[^\p{L}\p{N}]+/u)) {
    if (!/^\d{1,6}$/.test(tok)) continue;
    const n = Number(tok);
    if (n >= min && n <= max) return n;
  }
  return undefined;
}

const isLetter = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/** Vị trí các chữ cái / chữ số trong đáp án (để mở dần) */
export function letterIndices(answer: string): number[] {
  return Array.from(answer)
    .map((ch, i) => (isLetter(ch) ? i : -1))
    .filter((i) => i >= 0);
}

export interface BoardCell {
  /** Ký tự đã mở (null = ô trống chưa mở) */
  ch: string | null;
  space: boolean;
}

/** Ô chữ cho khán giả: chỉ lộ những chữ đã mở */
export function boardOf(answer: string, revealed: number[], showAll = false): BoardCell[] {
  const open = new Set(revealed);
  return Array.from(answer).map((ch, i) => {
    if (/\s/.test(ch)) return { ch: null, space: true };
    if (!isLetter(ch)) return { ch, space: false };
    return { ch: showAll || open.has(i) ? ch.toUpperCase() : null, space: false };
  });
}

/** Chọn ngẫu nhiên 1 chữ chưa mở */
export function pickRevealIndex(answer: string, revealed: number[], rand: () => number = Math.random): number | undefined {
  const open = new Set(revealed);
  const left = letterIndices(answer).filter((i) => !open.has(i));
  if (left.length === 0) return undefined;
  return left[Math.floor(rand() * left.length)];
}

/**
 * Bình luận rõ ràng KHÔNG phải câu trả lời (để không bị tính mất lượt khi "mỗi người 1 lần"):
 * câu hỏi, có số điện thoại, có mã sản phẩm (A1, SP12…), hoặc chỉ là con số trong khi đáp án là chữ.
 * Chỉ dùng cho câu trả lời SAI — câu trả lời đúng luôn được nhận.
 */
export function looksLikeNonAnswer(comment: string, answers: string[]): boolean {
  const c = normalizeAnswer(comment);
  if (!c) return true;
  if (extractPhones(comment).length > 0) return true;
  if (isQuestion(comment)) return true;
  const ans = answers.map((a) => normalizeAnswer(a));
  const answerTokens = new Set(ans.flatMap((a) => a.split(' ')));
  if (!ans.some((a) => /\d/.test(a)) && /^\d+$/.test(c.replace(/ /g, ''))) return true;
  if (c.split(' ').some((t) => /^[a-z]{1,3}\d{1,3}$/.test(t) && !answerTokens.has(t))) return true;
  return false;
}
