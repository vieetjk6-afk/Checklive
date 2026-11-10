import type { AdapterCallbacks, LiveAdapter, Platform } from '../core/types.js';
import { ExtensionAdapter, type ExtensionHub } from './extension.js';
import { FacebookAdapter } from './facebook.js';
import { SimulatorAdapter } from './simulator.js';
import { TikTokAdapter } from './tiktok.js';

export interface ChannelConfig {
  id: string;
  platform: Platform;
  handle: string;
  accessToken?: string | null;
  connector?: 'API' | 'EXTENSION';
}

export interface AdapterEnv {
  eulerApiKey?: string;
  fbGraphVersion: string;
  extensionHub?: ExtensionHub;
}

export type AdapterFactory = (channel: ChannelConfig, cb: AdapterCallbacks) => LiveAdapter;

export function createAdapterFactory(env: AdapterEnv): AdapterFactory {
  return (channel, cb) => {
    if (channel.connector === 'EXTENSION') {
      if (!env.extensionHub) throw new Error('Chưa bật nhận dữ liệu từ tiện ích Chrome');
      return new ExtensionAdapter(channel.id, cb, env.extensionHub);
    }
    switch (channel.platform) {
      case 'TIKTOK':
        return new TikTokAdapter(cb, { username: channel.handle, signApiKey: env.eulerApiKey });
      case 'FACEBOOK':
        return new FacebookAdapter(cb, {
          pageId: channel.handle,
          accessToken: channel.accessToken ?? '',
          graphVersion: env.fbGraphVersion,
        });
      case 'SIMULATOR':
        return new SimulatorAdapter(cb, { seed: channel.id });
    }
  };
}
