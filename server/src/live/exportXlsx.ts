import ExcelJS from 'exceljs';
import type { DB } from '../db.js';
import { extractPhones } from '../core/text.js';
import { loadAggregator } from './persistence.js';
import type { StatsSnapshot } from './stats.js';

const PLATFORM_LABEL: Record<string, string> = { TIKTOK: 'TikTok', FACEBOOK: 'Facebook', SIMULATOR: 'Giả lập' };

function fmt(d: Date | number | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'number' ? new Date(d) : d;
  return date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Xuất file Excel cho 1 phiên: Tổng quan, Bình luận, Người tham gia, Theo phút. */
export async function buildSessionWorkbook(
  db: DB,
  session: { id: string; title: string; status: string; startedAt: Date | null; endedAt: Date | null; channels: { channel: { id: string; name: string; platform: string } }[] },
  live?: StatsSnapshot,
): Promise<Buffer> {
  const stats = live ?? (await loadAggregator(db, session.id)).snapshot();
  const channelName = new Map(session.channels.map((c) => [c.channel.id, c.channel.name]));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Checklive';

  // 1. Tổng quan
  const s1 = wb.addWorksheet('Tổng quan');
  s1.columns = [{ header: 'Chỉ số', key: 'k', width: 32 }, { header: 'Giá trị', key: 'v', width: 40 }];
  const t = stats.totals;
  [
    ['Phiên live', session.title],
    ['Kênh', session.channels.map((c) => `${c.channel.name} (${PLATFORM_LABEL[c.channel.platform]})`).join(', ')],
    ['Bắt đầu', fmt(session.startedAt)],
    ['Kết thúc', fmt(session.endedAt)],
    ['Người xem cao nhất', stats.peakViewers],
    ['Bình luận', t.comment],
    ['Người bình luận (không trùng)', stats.uniqueCommenters],
    ['Like / cảm xúc', t.like],
    ['Share', t.share],
    ['Follow mới', t.follow],
    ['Quà', t.gift],
    ['Giá trị quà (kim cương)', t.giftValue],
    ['Lượt vào phòng', t.join],
  ].forEach(([k, v]) => s1.addRow({ k, v }));
  for (const [p, c] of Object.entries(stats.byPlatform)) {
    s1.addRow({});
    s1.addRow({ k: `— ${PLATFORM_LABEL[p] ?? p} —` });
    s1.addRow({ k: 'Bình luận', v: c!.comment });
    s1.addRow({ k: 'Like / cảm xúc', v: c!.like });
    s1.addRow({ k: 'Share', v: c!.share });
    s1.addRow({ k: 'Follow mới', v: c!.follow });
    s1.addRow({ k: 'Quà', v: c!.gift });
  }
  styleHeader(s1);

  // 2. Bình luận
  const s2 = wb.addWorksheet('Bình luận');
  s2.columns = [
    { header: 'Thời gian', key: 'time', width: 22 },
    { header: 'Nền tảng', key: 'platform', width: 11 },
    { header: 'Kênh', key: 'channel', width: 22 },
    { header: 'Tên', key: 'name', width: 24 },
    { header: 'Username', key: 'handle', width: 20 },
    { header: 'ID người dùng', key: 'uid', width: 22 },
    { header: 'Nội dung', key: 'content', width: 60 },
    { header: 'SĐT phát hiện', key: 'phones', width: 18 },
  ];
  let cursor: bigint | undefined;
  for (;;) {
    const rows = await db.liveEvent.findMany({
      where: { sessionId: session.id, type: 'comment', ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: 5000,
    });
    for (const r of rows) {
      s2.addRow({
        time: fmt(r.platformTs),
        platform: PLATFORM_LABEL[r.platform],
        channel: channelName.get(r.channelId) ?? '',
        name: r.userName ?? '',
        handle: r.userHandle ?? '',
        uid: r.platformUserId ?? '',
        content: r.content ?? '',
        phones: extractPhones(r.content ?? '').join(', '),
      });
    }
    if (rows.length < 5000) break;
    cursor = rows[rows.length - 1].id;
  }
  styleHeader(s2);

  // 3. Người tham gia
  const s3 = wb.addWorksheet('Người tham gia');
  s3.columns = [
    { header: 'Nền tảng', key: 'platform', width: 11 },
    { header: 'Tên', key: 'name', width: 24 },
    { header: 'Username', key: 'handle', width: 20 },
    { header: 'ID người dùng', key: 'uid', width: 22 },
    { header: 'Bình luận', key: 'comments', width: 11 },
    { header: 'Like', key: 'likes', width: 9 },
    { header: 'Share', key: 'shares', width: 9 },
    { header: 'Follow', key: 'follows', width: 9 },
    { header: 'Quà', key: 'gifts', width: 9 },
    { header: 'Giá trị quà', key: 'giftValue', width: 12 },
    { header: 'Lần đầu', key: 'first', width: 22 },
    { header: 'Lần cuối', key: 'last', width: 22 },
  ];
  const users = await db.sessionUser.findMany({ where: { sessionId: session.id }, orderBy: [{ comments: 'desc' }, { likes: 'desc' }] });
  for (const u of users) {
    s3.addRow({
      platform: PLATFORM_LABEL[u.platform],
      name: u.userName ?? '',
      handle: u.userHandle ?? '',
      uid: u.platformUserId,
      comments: u.comments,
      likes: u.likes,
      shares: u.shares,
      follows: u.follows,
      gifts: u.gifts,
      giftValue: u.giftValue,
      first: fmt(u.firstSeenAt),
      last: fmt(u.lastSeenAt),
    });
  }
  styleHeader(s3);

  // 4. Theo phút
  const s4 = wb.addWorksheet('Theo phút');
  s4.columns = [
    { header: 'Phút', key: 'minute', width: 22 },
    { header: 'Người xem', key: 'viewers', width: 11 },
    { header: 'Bình luận', key: 'comments', width: 11 },
    { header: 'Like', key: 'likes', width: 9 },
    { header: 'Share', key: 'shares', width: 9 },
    { header: 'Follow', key: 'follows', width: 9 },
    { header: 'Quà', key: 'gifts', width: 9 },
    { header: 'Vào phòng', key: 'joins', width: 11 },
  ];
  for (const p of stats.series) s4.addRow({ ...p, minute: fmt(p.minute) });
  styleHeader(s4);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
