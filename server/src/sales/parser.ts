import { extractPhones, normalizeText } from '../core/text.js';

/**
 * Bộ đọc bình luận chốt đơn.
 *
 * Hiểu được các dạng:  "A1", "a1 2", "A1 x2", "A1x2", "A1 đỏ M", "chốt A2 size L 2 cái",
 * "A1 + A3", "A1 đỏ, A2 xanh L 2", "0912345678 lấy A2", "chốt" / "+1" (= sản phẩm đang bán).
 * Bình luận dạng câu hỏi ("A1 còn không?", "A2 giá bao nhiêu") KHÔNG tạo đơn.
 */

export interface ParserVariant {
  id: string;
  /** {"Màu": "Đỏ", "Size": "M"} ; {} = biến thể mặc định */
  options: Record<string, string>;
}

export interface ParserProduct {
  /** ID sản phẩm trong phiên (SessionProduct) */
  id: string;
  code: string;
  status: 'WAITING' | 'SELLING' | 'CLOSED';
  openedAt?: number | null;
  variants: ParserVariant[];
}

export interface ParserConfig {
  mode: 'ALL_CODES' | 'SELLING_ONLY';
  /** Từ khoá chốt cho sản phẩm đang bán, VD ["chot", "+1", "lay"] */
  keywords: string[];
}

export interface ParsedLine {
  sessionProductId: string;
  code: string;
  quantity: number;
  /** Có khi xác định được đúng 1 phân loại */
  variantId?: string;
  /** Các phân loại có thể (khi chưa xác định được) */
  candidateVariantIds: string[];
  /** Tạo ra nhờ từ khoá chốt (không có mã) */
  viaKeyword: boolean;
}

export interface ParseResult {
  lines: ParsedLine[];
  phones: string[];
  isQuestion: boolean;
  /** Mã tìm thấy nhưng không nhận (sản phẩm đã đóng / chưa mở bán) */
  ignoredCodes: string[];
  /** Từ trông giống mã sản phẩm (VD "A4") nhưng không có trong phiên */
  unknownCodes: string[];
}

/** Trông giống mã sản phẩm: 1–3 chữ cái + 1–3 chữ số (A4, SP12, ab3) */
const CODE_LIKE = /^[a-z]{1,3}\d{1,3}$/;

export const MAX_QTY = 99;

/** Chuẩn hoá mã: bỏ dấu, chữ thường, bỏ khoảng trắng và ký tự đặc biệt đầu (#) */
export function normalizeCode(code: string): string {
  return normalizeText(code).replace(/\s+/g, '').replace(/^#+/, '');
}

/** Mã hợp lệ: chữ / số / - / _ , có ít nhất 1 ký tự */
export function isValidCode(code: string): boolean {
  const c = code.trim();
  return !/\s/.test(c) && /^[a-z0-9][a-z0-9_-]{0,19}$/.test(normalizeCode(c));
}

const ALIASES: Record<string, string> = { xxl: '2xl', xxxl: '3xl', xxxxl: '4xl' };
const normValue = (v: string) => {
  const n = normalizeText(v);
  return ALIASES[n] ?? n;
};

const UNITS = 'c|cai|chiec|bo|doi|hop|sp|goi|chai|lo|tuyp|cuon|set|pcs|cay|tui|qua|hu|thung';
const RE_UNIT_GLUED = new RegExp(`^(\\d{1,2})(?:${UNITS})$`);
const RE_UNIT = new RegExp(`^(?:${UNITS})$`);

const QUESTION_PATTERNS: RegExp[] = [
  /\?/,
  /\b(con|co)\s+(khong|ko|k|hong|hok|hem)\b/,
  /\bbao nhieu\b/,
  /\bgia\s*(bao|sao|nhieu|the nao|ntn)\b/,
  /\b(xin|cho xin|hoi)\s+gia\b/,
  /\b(the nao|nhu nao|ntn|sao a|duoc khong|dc khong|dc ko|duoc ko|co duoc)\b/,
  /\b(khong|ko|hong|hok)\s+(a|shop|sop|ban|chi|c|e|em|ad|ak|ah)\s*$/,
  /\bcon\s+(hang|size|mau)\b/,
];

export function isQuestion(text: string): boolean {
  const n = normalizeText(text);
  return QUESTION_PATTERNS.some((re) => re.test(n));
}

/** Tách token: bỏ SĐT, bỏ dấu câu, tách "a1+a3", giữ "+1" */
export function tokenize(text: string): string[] {
  let n = normalizeText(text);
  for (const m of n.match(/(?:\+?84|0)(?:[\s.\-]?\d){9}(?!\d)/g) ?? []) n = n.replace(m, ' ');
  n = n.replace(/[,;:|/\\()[\]{}!?~"'“”]+/g, ' ').replace(/(?<=\S)\.(?=\s|$)|(?<=\s|^)\.(?=\S)/g, ' ');
  const out: string[] = [];
  for (const raw of n.split(/\s+/)) {
    if (!raw) continue;
    if (/^\+\d+$/.test(raw)) {
      out.push(raw);
      continue;
    }
    for (const part of raw.split('+')) {
      const p = part.replace(/^#+/, '').replace(/^\.+|\.+$/g, '');
      if (p) out.push(p);
    }
  }
  return out;
}

interface Seg {
  product?: ParserProduct;
  tokens: string[];
}

/** Lấy số lượng có đánh dấu rõ (x2, *2, 2 cái, sl 2…). Trả về [số lượng | undefined, token còn lại] */
function takeExplicitQty(tokens: string[]): [number | undefined, string[]] {
  let qty: number | undefined;
  const used = new Set<number>();
  for (let i = 0; i < tokens.length && qty === undefined; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^[x*](\d{1,2})$/)) || (m = t.match(/^(\d{1,2})x$/)) || (m = t.match(RE_UNIT_GLUED)) || (m = t.match(/^sl(\d{1,2})$/))) {
      qty = Number(m[1]);
      used.add(i);
    } else if ((t === 'x' || t === '*' || t === 'sl') && next && /^\d{1,2}$/.test(next)) {
      qty = Number(next);
      used.add(i).add(i + 1);
    } else if (t === 'so' && next === 'luong' && tokens[i + 2] && /^\d{1,2}$/.test(tokens[i + 2])) {
      qty = Number(tokens[i + 2]);
      used.add(i).add(i + 1).add(i + 2);
    } else if (/^\d{1,2}$/.test(t) && next && RE_UNIT.test(next)) {
      qty = Number(t);
      used.add(i).add(i + 1);
    }
  }
  return [qty, tokens.filter((_, i) => !used.has(i))];
}

/** Tìm giá trị phân loại trong token (ưu tiên cụm dài: "xanh than" trước "xanh"). */
function matchVariantValues(product: ParserProduct, tokens: string[]): [Map<string, Set<string>>, string[]] {
  // giá trị chuẩn hoá -> danh sách {thuộc tính, giá trị gốc chuẩn hoá}
  const valueIndex = new Map<string, Set<string>>(); // normValue -> set of attribute names
  for (const v of product.variants) {
    for (const [attr, val] of Object.entries(v.options)) {
      const nv = normValue(val);
      if (!nv) continue;
      if (!valueIndex.has(nv)) valueIndex.set(nv, new Set());
      valueIndex.get(nv)!.add(attr);
    }
  }
  const matched = new Map<string, Set<string>>(); // attr -> set of normValue
  const used = new Set<number>();
  for (let size = 3; size >= 1; size--) {
    for (let i = 0; i + size <= tokens.length; i++) {
      if ([...Array(size).keys()].some((k) => used.has(i + k))) continue;
      const phrase = normValue(tokens.slice(i, i + size).join(' '));
      const attrs = valueIndex.get(phrase);
      if (!attrs) continue;
      for (const a of attrs) {
        if (!matched.has(a)) matched.set(a, new Set());
        matched.get(a)!.add(phrase);
      }
      for (let k = 0; k < size; k++) used.add(i + k);
    }
  }
  return [matched, tokens.filter((_, i) => !used.has(i))];
}

function resolveVariants(product: ParserProduct, matched: Map<string, Set<string>>): string[] {
  if (product.variants.length <= 1) return product.variants.map((v) => v.id);
  return product.variants
    .filter((v) => {
      for (const [attr, values] of matched) {
        const own = v.options[attr];
        if (own === undefined || !values.has(normValue(own))) return false;
      }
      return true;
    })
    .map((v) => v.id);
}

function buildLine(product: ParserProduct, tokens: string[], viaKeyword: boolean): ParsedLine {
  const [explicitQty, rest1] = takeExplicitQty(tokens);
  const [matched, rest2] = matchVariantValues(product, rest1);
  let qty = explicitQty;
  if (qty === undefined) {
    const bare = rest2.find((t) => /^\d{1,2}$/.test(t));
    if (bare) qty = Number(bare);
  }
  qty = Math.min(MAX_QTY, Math.max(1, qty ?? 1));
  const candidates = resolveVariants(product, matched);
  return {
    sessionProductId: product.id,
    code: product.code,
    quantity: qty,
    variantId: candidates.length === 1 ? candidates[0] : undefined,
    candidateVariantIds: candidates.length === 1 ? [] : candidates.length ? candidates : product.variants.map((v) => v.id),
    viaKeyword,
  };
}

export function parseOrderComment(text: string, products: ParserProduct[], config: ParserConfig): ParseResult {
  const phones = extractPhones(text);
  const result: ParseResult = { lines: [], phones, isQuestion: isQuestion(text), ignoredCodes: [], unknownCodes: [] };
  if (result.isQuestion || products.length === 0) return result;

  const byCode = new Map(products.map((p) => [normalizeCode(p.code), p]));
  const accepts = (p: ParserProduct) =>
    p.status === 'SELLING' || (p.status === 'WAITING' && config.mode === 'ALL_CODES');

  // Tách "a1x2" -> "a1", "x2" khi phần đầu là mã
  const tokens: string[] = [];
  for (const t of tokenize(text)) {
    const m = t.match(/^(.+?)([x*]\d{1,2})$/);
    if (m && byCode.has(m[1]) && !byCode.has(t)) tokens.push(m[1], m[2]);
    else tokens.push(t);
  }

  // Từ giống mã nhưng không có trong phiên (trừ khi đó là giá trị phân loại, VD size "M1")
  const variantValues = new Set(products.flatMap((p) => p.variants.flatMap((v) => Object.values(v.options).map(normValue))));
  for (const t of tokens) {
    if (CODE_LIKE.test(t) && !/^(x|sl)\d{1,2}$/.test(t) && !byCode.has(t) && !variantValues.has(t) && !result.unknownCodes.includes(t.toUpperCase())) {
      result.unknownCodes.push(t.toUpperCase());
    }
  }

  // Chia đoạn theo mã
  const segs: Seg[] = [{ tokens: [] }];
  for (const t of tokens) {
    const p = byCode.get(t);
    if (p) segs.push({ product: p, tokens: [] });
    else segs[segs.length - 1].tokens.push(t);
  }

  const hasCode = segs.length > 1;
  if (hasCode) {
    // Phần đứng trước mã đầu tiên ("lấy 2 cái A2", "2 A1") thuộc về mã đầu tiên
    segs[1].tokens = [...segs[0].tokens, ...segs[1].tokens];
    for (const seg of segs) {
      if (!seg.product) continue;
      if (!accepts(seg.product)) {
        if (!result.ignoredCodes.includes(seg.product.code)) result.ignoredCodes.push(seg.product.code);
        continue;
      }
      result.lines.push(buildLine(seg.product, seg.tokens, false));
    }
  } else {
    const keywords = new Set(config.keywords.map((k) => normalizeText(k)));
    // Khách ghi rõ một mã khác (không có trong phiên) thì KHÔNG tự gán cho sản phẩm đang bán
    if (result.unknownCodes.length === 0 && tokens.some((t) => keywords.has(t))) {
      const selling = products
        .filter((p) => p.status === 'SELLING')
        .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))[0];
      if (selling) {
        const rest = tokens.filter((t) => !keywords.has(t));
        result.lines.push(buildLine(selling, rest, true));
      }
    }
  }

  // Gộp các dòng trùng sản phẩm + phân loại đã xác định
  const merged: ParsedLine[] = [];
  for (const l of result.lines) {
    const same = l.variantId && merged.find((m) => m.sessionProductId === l.sessionProductId && m.variantId === l.variantId);
    if (same) same.quantity = Math.min(MAX_QTY, same.quantity + l.quantity);
    else merged.push(l);
  }
  result.lines = merged;
  return result;
}
