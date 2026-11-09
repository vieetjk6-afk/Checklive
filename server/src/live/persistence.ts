import type { Prisma } from '@prisma/client';
import type { DB } from '../db.js';
import type { LiveEvent } from '../core/types.js';
import { StatsAggregator, type MinuteAgg, type UserAgg } from './stats.js';

/** Các loại sự kiện được lưu từng dòng. "join" chỉ lưu dạng tổng hợp theo phút để tiết kiệm dung lượng. */
export const PERSISTED_TYPES = new Set(['comment', 'like', 'share', 'follow', 'gift']);

export function toEventRow(e: LiveEvent): Prisma.LiveEventCreateManyInput {
  return {
    sessionId: e.sessionId,
    channelId: e.channelId,
    platform: e.platform,
    type: e.type,
    externalId: e.externalId ?? null,
    platformUserId: e.user?.id ?? null,
    userName: e.user?.name ?? null,
    userHandle: e.user?.handle ?? null,
    avatarUrl: e.user?.avatarUrl ?? null,
    content: e.content ?? null,
    count: e.count,
    value: e.value,
    platformTs: new Date(e.platformTs),
    receivedAt: new Date(e.receivedAt),
    tag: e.tag ?? null,
    tagKind: e.tagKind ?? null,
  };
}

export async function saveEvents(db: DB, events: LiveEvent[]): Promise<void> {
  const rows = events.filter((e) => PERSISTED_TYPES.has(e.type)).map(toEventRow);
  for (let i = 0; i < rows.length; i += 1000) {
    await db.liveEvent.createMany({ data: rows.slice(i, i + 1000) });
  }
}

export async function saveAggregates(db: DB, sessionId: string, users: UserAgg[], minutes: MinuteAgg[]): Promise<void> {
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const u of users) {
    const data = {
      userName: u.userName ?? null,
      userHandle: u.userHandle ?? null,
      avatarUrl: u.avatarUrl ?? null,
      comments: u.comments,
      likes: u.likes,
      shares: u.shares,
      follows: u.follows,
      gifts: u.gifts,
      giftValue: u.giftValue,
      firstSeenAt: new Date(u.firstSeenAt),
      lastSeenAt: new Date(u.lastSeenAt),
    };
    ops.push(
      db.sessionUser.upsert({
        where: { sessionId_platform_platformUserId: { sessionId, platform: u.platform, platformUserId: u.platformUserId } },
        create: { sessionId, platform: u.platform, platformUserId: u.platformUserId, ...data },
        update: data,
      }),
    );
  }
  for (const m of minutes) {
    const data = {
      comments: m.comments,
      likes: m.likes,
      shares: m.shares,
      follows: m.follows,
      gifts: m.gifts,
      joins: m.joins,
      viewersMax: m.viewersMax,
    };
    ops.push(
      db.sessionMinute.upsert({
        where: { sessionId_platform_minute: { sessionId, platform: m.platform, minute: new Date(m.minute) } },
        create: { sessionId, platform: m.platform, minute: new Date(m.minute), ...data },
        update: data,
      }),
    );
  }
  for (let i = 0; i < ops.length; i += 200) {
    await db.$transaction(ops.slice(i, i + 200));
  }
}

/** Dựng lại bộ thống kê từ dữ liệu đã lưu của 1 phiên. */
export async function loadAggregator(db: DB, sessionId: string): Promise<StatsAggregator> {
  const [session, users, minutes] = await Promise.all([
    db.liveSession.findUnique({ where: { id: sessionId }, select: { peakViewers: true } }),
    db.sessionUser.findMany({ where: { sessionId } }),
    db.sessionMinute.findMany({ where: { sessionId } }),
  ]);
  return StatsAggregator.hydrate({
    peakViewers: session?.peakViewers ?? 0,
    users: users.map((u) => ({
      platform: u.platform,
      platformUserId: u.platformUserId,
      userName: u.userName ?? undefined,
      userHandle: u.userHandle ?? undefined,
      avatarUrl: u.avatarUrl ?? undefined,
      comments: u.comments,
      likes: u.likes,
      shares: u.shares,
      follows: u.follows,
      gifts: u.gifts,
      giftValue: u.giftValue,
      firstSeenAt: u.firstSeenAt.getTime(),
      lastSeenAt: u.lastSeenAt.getTime(),
    })),
    minutes: minutes.map((m) => ({
      platform: m.platform,
      minute: m.minute.getTime(),
      comments: m.comments,
      likes: m.likes,
      shares: m.shares,
      follows: m.follows,
      gifts: m.gifts,
      joins: m.joins,
      viewersMax: m.viewersMax,
    })),
  });
}
