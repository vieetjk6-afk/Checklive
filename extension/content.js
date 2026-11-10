/*
 * Chạy trong trang Facebook. Khi được bật: theo dõi bình luận mới xuất hiện trên trang
 * và gửi về service worker (background.js) để chuyển lên server Checklive.
 * Chỉ ĐỌC những gì đang hiển thị, không bấm / không gửi gì lên Facebook.
 */
(function () {
  'use strict';
  if (window.__checkliveConnector) return;
  window.__checkliveConnector = true;

  const FB = window.CheckliveFB;
  const HASH_WINDOW_MS = 120000; // bình luận không có ID: cùng người + cùng nội dung trong 2 phút coi là 1
  const HEARTBEAT_MS = 15000;
  const SCAN_GAP_MS = 300;

  let running = false;
  let observer = null;
  let heartbeat = null;
  let scanTimer = null;
  let lastScan = 0;
  let seenEls = new WeakSet();
  let seenIds = new Set();
  let seenHashes = new Map();
  let queue = [];
  let sending = false;
  let sent = 0;
  let lastError = '';

  function remember(c) {
    const key = FB.commentKey(c);
    const now = Date.now();
    if (c.id) {
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    }
    const at = seenHashes.get(key);
    if (at && now - at < HASH_WINDOW_MS) return false;
    seenHashes.set(key, now);
    if (seenHashes.size > 5000) {
      for (const [k, t] of seenHashes) if (now - t > HASH_WINDOW_MS) seenHashes.delete(k);
    }
    return true;
  }

  /** Quét trang. initial = lần đầu: chỉ ghi nhớ bình luận cũ, không gửi. */
  function scan(initial) {
    lastScan = Date.now();
    let found = 0;
    for (const el of FB.findCommentArticles(document)) {
      if (seenEls.has(el)) continue;
      const c = FB.extractComment(el);
      if (!c) continue; // chưa tải xong, lần sau quét lại
      seenEls.add(el);
      if (!remember(c)) continue;
      if (!initial) {
        queue.push({ ...c, ts: Date.now() });
        found++;
      }
    }
    if (found) flush();
  }

  function requestScan() {
    if (!running) return;
    const wait = SCAN_GAP_MS - (Date.now() - lastScan);
    if (wait <= 0) scan(false);
    else if (!scanTimer) {
      scanTimer = setTimeout(() => {
        scanTimer = null;
        if (running) scan(false);
      }, wait);
    }
  }

  function payload(comments) {
    return {
      type: 'cl:comments',
      comments,
      viewers: FB.detectViewers(document),
      pageUrl: location.href,
      pageTitle: document.title,
    };
  }

  function flush(force) {
    if (sending || (!queue.length && !force)) return;
    sending = true;
    const batch = queue.splice(0, 200);
    let msg;
    try {
      msg = payload(batch);
    } catch (e) {
      msg = { type: 'cl:comments', comments: batch, pageUrl: location.href, pageTitle: document.title };
    }
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        sending = false;
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          lastError = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Không gửi được';
          queue = batch.concat(queue).slice(-2000); // giữ lại để gửi lại
          setTimeout(() => flush(), 3000);
          return;
        }
        lastError = '';
        sent += batch.length;
        if (queue.length) flush();
      });
    } catch (e) {
      // Tiện ích vừa được cập nhật / tải lại: script cũ không còn liên lạc được
      sending = false;
      stop();
    }
  }

  function start(skipExisting) {
    if (running) return;
    running = true;
    scan(skipExisting !== false);
    observer = new MutationObserver(requestScan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    heartbeat = setInterval(() => flush(true), HEARTBEAT_MS);
    flush(true);
  }

  function stop() {
    running = false;
    if (observer) observer.disconnect();
    observer = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'cl:start') {
      start(msg.skipExisting);
      sendResponse({ ok: true });
    } else if (msg.type === 'cl:stop') {
      stop();
      sendResponse({ ok: true });
    } else if (msg.type === 'cl:ping') {
      let detected = 0;
      try {
        detected = FB.findCommentArticles(document).filter((el) => FB.extractComment(el)).length;
      } catch (e) {
        detected = -1;
      }
      sendResponse({ running, detected, sent, queued: queue.length, lastError, viewers: FB.detectViewers(document) });
    }
  });

  // Trang được tải lại khi đang bật: tự bật lại
  try {
    chrome.runtime.sendMessage({ type: 'cl:hello' }, (resp) => {
      if (!chrome.runtime.lastError && resp && resp.shouldRun) start(true);
    });
  } catch (e) {
    /* bỏ qua */
  }
})();
