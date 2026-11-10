/*
 * Service worker của tiện ích: nhận bình luận từ trang Facebook và gửi lên server Checklive.
 * Lưu trạng thái từng tab trong chrome.storage.session để không mất khi service worker bị tắt.
 */
importScripts('config.js');

async function getSettings() {
  const s = await chrome.storage.local.get(['server', 'token', 'skipExisting']);
  return {
    server: String(s.server || self.CHECKLIVE_DEFAULT_SERVER || '').trim().replace(/\/+$/, ''),
    token: String(s.token || '').trim(),
    skipExisting: s.skipExisting !== false,
  };
}

const tabKey = (tabId) => `tab:${tabId}`;

async function getTab(tabId) {
  const k = tabKey(tabId);
  const s = await chrome.storage.session.get(k);
  return s[k] || { running: false, sent: 0, lastOkAt: 0, lastError: '', remoteRunning: null, sessionTitle: null, message: '' };
}

async function setTab(tabId, patch) {
  const cur = await getTab(tabId);
  const next = { ...cur, ...patch };
  await chrome.storage.session.set({ [tabKey(tabId)]: next });
  return next;
}

async function badge(tabId, st) {
  try {
    if (!st.running) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    const ok = !st.lastError && st.remoteRunning !== false;
    await chrome.action.setBadgeText({ tabId, text: ok ? 'ON' : '!' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: ok ? '#059669' : '#e11d48' });
  } catch (e) {
    /* tab đã đóng */
  }
}

async function api(path, init = {}) {
  const { server, token } = await getSettings();
  if (!server) throw new Error('Chưa nhập địa chỉ server Checklive');
  if (!token) throw new Error('Chưa nhập mã kết nối');
  const res = await fetch(server + path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

/** Gửi 1 lô bình luận lên server */
async function forward(tabId, msg) {
  const st = await getTab(tabId);
  if (!st.running) return { ok: true, ignored: true };
  try {
    const r = await api('/api/ext/events', {
      method: 'POST',
      body: JSON.stringify({ comments: msg.comments || [], viewers: msg.viewers, pageUrl: msg.pageUrl, pageTitle: msg.pageTitle }),
    });
    const next = await setTab(tabId, {
      sent: st.sent + (r.accepted || 0),
      lastOkAt: Date.now(),
      lastError: '',
      remoteRunning: !!r.running,
      sessionTitle: r.sessionTitle || null,
      message: r.message || '',
    });
    await badge(tabId, next);
    return { ok: true, running: r.running };
  } catch (e) {
    const next = await setTab(tabId, { lastError: e.message || String(e) });
    await badge(tabId, next);
    return { ok: false, error: next.lastError };
  }
}

async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    // Tab mở trước khi cài tiện ích: nạp script vào trang rồi thử lại
    await chrome.scripting.executeScript({ target: { tabId }, files: ['fb-extract.js', 'content.js'] });
    return chrome.tabs.sendMessage(tabId, msg);
  }
}

/** Bật gửi bình luận cho 1 tab (dùng chung cho popup và test) */
async function startTab(tabId) {
  const { skipExisting } = await getSettings();
  const st = await setTab(tabId, { running: true, lastError: '', message: '' });
  await badge(tabId, st);
  await sendToTab(tabId, { type: 'cl:start', skipExisting });
  return st;
}

async function stopTab(tabId) {
  const st = await setTab(tabId, { running: false });
  await badge(tabId, st);
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'cl:stop' });
  } catch (e) {
    /* tab không còn script */
  }
  return st;
}

self.clStartTab = startTab;
self.clStopTab = stopTab;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;
  (async () => {
    switch (msg && msg.type) {
      case 'cl:comments':
        return forward(tabId, msg);
      case 'cl:hello':
        return { shouldRun: (await getTab(tabId)).running };
      case 'popup:state': {
        const settings = await getSettings();
        const st = msg.tabId ? await getTab(msg.tabId) : null;
        let page = null;
        if (msg.tabId) {
          try {
            page = await chrome.tabs.sendMessage(msg.tabId, { type: 'cl:ping' });
          } catch (e) {
            page = null;
          }
        }
        return { settings, tab: st, page };
      }
      case 'popup:save': {
        await chrome.storage.local.set({ server: msg.server, token: msg.token, skipExisting: msg.skipExisting !== false });
        try {
          return { ok: true, who: await api('/api/ext/whoami') };
        } catch (e) {
          return { ok: false, error: e.message || String(e) };
        }
      }
      case 'popup:whoami':
        try {
          return { ok: true, who: await api('/api/ext/whoami') };
        } catch (e) {
          return { ok: false, error: e.message || String(e) };
        }
      case 'popup:start':
        try {
          await startTab(msg.tabId);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e.message || String(e) };
        }
      case 'popup:stop':
        await stopTab(msg.tabId);
        return { ok: true };
      default:
        return undefined;
    }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(tabKey(tabId)).catch(() => {});
});
