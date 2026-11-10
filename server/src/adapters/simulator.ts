import type { AdapterCallbacks, LiveAdapter, LiveUser } from '../core/types.js';

const NAMES = [
  'Nguyễn Thu Hà', 'Trần Minh Anh', 'Lê Hoàng Yến', 'Phạm Ngọc Lan', 'Hoàng Thị Mai', 'Vũ Đức Thắng',
  'Đặng Phương Thảo', 'Bùi Khánh Linh', 'Đỗ Quỳnh Như', 'Hồ Bảo Ngọc', 'Ngô Thanh Tâm', 'Dương Mỹ Duyên',
  'Lý Gia Hân', 'Trịnh Hải Yến', 'Mai Anh Thư', 'Phan Thuỳ Dung', 'Cao Kim Oanh', 'Tạ Thu Trang',
  'Lâm Tuyết Nhi', 'Châu Ngọc Hân', 'Kiều Minh Châu', 'Quách Tú Anh', 'Võ Hồng Nhung', 'Đinh Lan Phương',
  'Huỳnh Thanh Hương', 'Tô Diệu Linh', 'Lưu Bích Ngọc', 'Hà Phương Vy', 'Thái Mỹ Linh', 'Âu Thảo Nguyên',
];

const COMMENTS = [
  'A1', 'A1 đỏ M', 'chốt A2 size L 2 cái', 'A3 x2', 'giá bao nhiêu shop ơi', 'còn màu đen không ạ',
  'chốt', '+1', 'lấy A1 trắng S', 'ship Hà Nội mấy ngày shop', 'đẹp quá', 'xin giá A5', 'hay quá shop ơi',
  '0912 345 678 lấy A2', 'A4 xanh XL', 'đã share', 'tim tim', 'shop có freeship không', 'chốt A1 + A3',
  'size M còn không', 'chất liệu gì vậy shop', 'mình ở Đà Nẵng ship được không', '1', 'xinh xỉu',
  'A2 đen L 1', '0987.654.321 chốt A4', 'đặt 2 cái A1', 'đã follow', 'quá rẻ luôn', 'có bảo hành không',
];

const GAME_GUESSES = ['áo dài', 'Áo Dài', 'ao dai', 'nón lá', 'áo bà ba', 'con mèo', 'hoa sen', 'đáp án là áo dài'];

const GIFTS = [
  { name: 'Hoa hồng', value: 1 },
  { name: 'Kẹo bông', value: 5 },
  { name: 'Mũ', value: 99 },
  { name: 'Nhẫn', value: 299 },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Kênh giả lập: tự sinh bình luận, like, share… để thử hệ thống
 * khi chưa có Fanpage / kênh TikTok thật đang live.
 */
export class SimulatorAdapter implements LiveAdapter {
  private timers: NodeJS.Timeout[] = [];
  private viewers = 120;
  private users: LiveUser[];

  constructor(
    private cb: AdapterCallbacks,
    private opts: { eventsPerSecond?: number; seed?: string } = {},
  ) {
    this.users = NAMES.map((name, i) => ({
      id: `sim-${opts.seed ?? 'x'}-${i}`,
      name,
      handle: stripForHandle(name) + i,
    }));
  }

  async start(): Promise<void> {
    this.cb.onStatus('connecting');
    const rate = this.opts.eventsPerSecond ?? 3;
    const t0 = setTimeout(() => {
      this.cb.onStatus('live', 'Kênh giả lập đang phát', `sim-${Date.now()}`);
      this.cb.onViewers(this.viewers);
      this.timers.push(setInterval(() => this.tick(), Math.max(50, Math.round(1000 / rate))));
      this.timers.push(
        setInterval(() => {
          this.viewers = Math.max(5, this.viewers + Math.round((Math.random() - 0.45) * 20));
          this.cb.onViewers(this.viewers);
        }, 2000),
      );
    }, 500);
    this.timers.push(t0);
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.cb.onStatus('stopped');
  }

  private tick() {
    const user = pick(this.users);
    const r = Math.random();
    if (r < 0.45) {
      // Trộn thêm bình luận kiểu chơi game (đoán số, đoán chữ, tham gia quay thưởng)
      const g = Math.random();
      const content =
        g < 0.18 ? String(1 + Math.floor(Math.random() * 100))
        : g < 0.24 ? `em đoán ${1 + Math.floor(Math.random() * 100)}`
        : g < 0.32 ? pick(GAME_GUESSES)
        : g < 0.37 ? 'tham gia'
        : pick(COMMENTS);
      this.cb.onEvent({ type: 'comment', user, content, externalId: `c${Date.now()}${Math.random()}` });
    } else if (r < 0.75) {
      this.cb.onEvent({ type: 'like', user, count: 1 + Math.floor(Math.random() * 15) });
    } else if (r < 0.82) {
      this.cb.onEvent({ type: 'share', user });
    } else if (r < 0.87) {
      this.cb.onEvent({ type: 'follow', user });
    } else if (r < 0.9) {
      const g = pick(GIFTS);
      const n = 1 + Math.floor(Math.random() * 3);
      this.cb.onEvent({ type: 'gift', user, content: g.name, count: n, value: g.value * n });
    } else {
      this.cb.onEvent({ type: 'join', user });
    }
  }
}

function stripForHandle(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}
