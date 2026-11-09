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
