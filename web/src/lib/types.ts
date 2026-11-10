// Kiểu dữ liệu trao đổi với server (khớp với server/src)
export type Platform = 'TIKTOK' | 'FACEBOOK' | 'SIMULATOR';
export type SessionStatus = 'DRAFT' | 'RUNNING' | 'ENDED';
export type ChannelStatus = 'connecting' | 'waiting' | 'live' | 'reconnecting' | 'ended' | 'error' | 'stopped';

export interface Me { id: string; email: string; name: string; role: string }

export interface Channel {
  id: string;
  platform: Platform;
  name: string;
  handle: string;
  isOwn: boolean;
  hasAccessToken: boolean;
  connector: 'API' | 'EXTENSION';
  connectorToken: string | null;
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  startedAt: string | null;
  endedAt: string | null;
  peakViewers: number;
  createdAt: string;
  channels: { id: string; name: string; platform: Platform }[];
}

export interface ChannelState {
  channelId: string;
  platform: Platform;
  name: string;
  handle: string;
  status: ChannelStatus;
  message?: string;
  viewers: number;
  externalLiveId?: string;
  updatedAt: number;
}

export interface SessionDetail extends Omit<SessionSummary, 'channels'> {
  publicId: string;
  channels: { id: string; name: string; platform: Platform; handle: string; isOwn: boolean; peakViewers: number }[];
  channelStates: ChannelState[];
}

export interface LiveUser { id: string; name?: string; handle?: string; avatarUrl?: string }

export interface Comment {
  key: string;
  channelId: string;
  platform: Platform;
  user?: LiveUser;
  content: string;
  phones: string[];
  platformTs: number;
  receivedAt: number;
  /** Kết quả xử lý chốt đơn */
  tag?: string;
  tagKind?: 'order' | 'waitlist' | 'warn' | 'question';
}

export interface Activity {
  key: string;
  channelId: string;
  platform: Platform;
  type: 'share' | 'follow' | 'gift';
  user?: LiveUser;
  content?: string;
  count: number;
  value: number;
  platformTs: number;
}

export interface Counts { comment: number; like: number; share: number; follow: number; gift: number; join: number; giftValue: number }
export interface TopUser { platform: Platform; id: string; name?: string; handle?: string; avatarUrl?: string; value: number }
export interface SeriesPoint { minute: number; comments: number; likes: number; shares: number; follows: number; gifts: number; joins: number; viewers: number }

export interface Stats {
  totals: Counts;
  byPlatform: Partial<Record<Platform, Counts>>;
  uniqueCommenters: number;
  uniqueUsers: number;
  viewersNow: number;
  viewersByChannel: Record<string, number>;
  peakViewers: number;
  series: SeriesPoint[];
  top: { comments: TopUser[]; likes: TopUser[]; shares: TopUser[]; gifts: TopUser[] };
}

// ───────── Bán hàng ─────────

export interface Attribute { name: string; values: string[] }

export interface Variant {
  id: string;
  options: Record<string, string>;
  label: string | null;
  sku: string | null;
  price: number | null;
  stock: number;
  reserved: number;
  available: number;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  attributes: Attribute[];
  active: boolean;
  variants: Variant[];
}

export type SessionProductStatus = 'WAITING' | 'SELLING' | 'CLOSED';

export interface SessionProduct {
  id: string;
  code: string;
  status: SessionProductStatus;
  livePrice: number | null;
  sessionLimit: number | null;
  perCustomerLimit: number | null;
  reservedQty: number;
  sortOrder: number;
  openedAt: string | null;
  orderedQty: number;
  waitlistQty: number;
  needsVariantQty: number;
  available: number;
  product: { id: string; name: string; imageUrl: string | null; price: number; attributes: Attribute[]; variants: Variant[] };
}

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'APPROVED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export type OrderItemStatus = 'RESERVED' | 'WAITLIST' | 'NEEDS_VARIANT' | 'CANCELLED';

export interface OrderItem {
  id: string;
  sessionProductId: string;
  variantId: string | null;
  code: string;
  productName: string;
  variantLabel: string | null;
  unitPrice: number;
  quantity: number;
  status: OrderItemStatus;
  sourceText: string | null;
  createdAt: string;
}

export interface Order {
  id: string;
  code: string;
  sessionId: string;
  status: OrderStatus;
  platform: Platform;
  platformUserId: string;
  displayName: string | null;
  handle: string | null;
  customer: { id: string; name: string; phone: string | null; address: string | null; blacklisted: boolean; note: string | null } | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  note: string | null;
  paymentMethod: 'COD' | 'BANK';
  paymentStatus: 'UNPAID' | 'PAID';
  total: number;
  holdUntil: string | null;
  confirmToken: string;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  items: OrderItem[];
}

export interface SalesSettings {
  holdMinutes: number | null;
  orderMode: 'ALL_CODES' | 'SELLING_ONLY';
  orderKeywords: string[];
  publicId: string;
}

export interface ShopSettings {
  name: string;
  bankBin: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  defaultHoldMinutes: number | null;
}

// ───────── Game show ─────────

export type GameType = 'NUMBER_GUESS' | 'WORD_GUESS' | 'QUIZ' | 'LUCKY_DRAW';
export type GameStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'DONE';

export interface GameConfig {
  min?: number;
  max?: number;
  answer?: string;
  revealed?: number[];
  answers?: string[];
  keyword?: string;
  accentInsensitive?: boolean;
}

export interface GameConditions {
  like?: boolean;
  share?: boolean;
  follow?: boolean;
  facebookPolicy?: 'skip' | 'exclude';
}

export interface GameWinner {
  id: string;
  rank: number;
  platform: Platform;
  platformUserId: string;
  userName: string | null;
  userHandle: string | null;
  avatarUrl: string | null;
  answer: string | null;
  answeredAt: string | null;
  prize: string | null;
  disqualified: boolean;
}

export interface Game {
  id: string;
  sessionId: string;
  type: GameType;
  title: string;
  question: string | null;
  config: GameConfig;
  winnersCount: number;
  prizes: string[];
  conditions: GameConditions;
  oneAttempt: boolean;
  durationSec: number | null;
  status: GameStatus;
  sortOrder: number;
  openedAt: string | null;
  closedAt: string | null;
  finishedAt: string | null;
  result: string | null;
  revealAt: string | null;
  answersCount: number;
  correctCount: number;
  winners: GameWinner[];
}

export interface GameAnswer {
  id: string;
  platform: Platform;
  platformUserId: string;
  userName: string | null;
  userHandle: string | null;
  avatarUrl: string | null;
  content: string;
  value: string | null;
  correct: boolean;
  platformTs: string;
}
