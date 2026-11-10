/*
 * Đọc bình luận từ giao diện Facebook (trang live video, Group, Fanpage, trang cá nhân).
 *
 * Facebook đổi tên class liên tục nên module này KHÔNG dựa vào class, mà dựa vào cấu trúc ổn định hơn:
 *  - Mỗi bình luận là 1 phần tử role="article" (aria-label "Bình luận của …" / "Comment by …"),
 *    hoặc có link chứa tham số comment_id.
 *  - Tên người bình luận là link tới trang cá nhân (profile.php?id=…, /ten.nguoi.dung, /groups/…/user/…).
 *  - Nội dung nằm trong các phần tử dir="auto" không thuộc link / nút bấm.
 * Khi Facebook đổi giao diện, chỉ cần sửa file này.
 */
(function (root) {
  'use strict';

  const FB_HOST = /(^|\.)facebook\.com$/i;
  // Đường dẫn không phải trang cá nhân
  const RESERVED = new Set([
    'watch', 'videos', 'video', 'groups', 'photo', 'photo.php', 'photos', 'permalink.php', 'story.php', 'hashtag', 'events', 'pages',
    'reel', 'reels', 'live', 'gaming', 'marketplace', 'login', 'login.php', 'home.php', 'notifications', 'friends', 'bookmarks',
    'search', 'sharer', 'sharer.php', 'share', 'l.php', 'messages', 'help', 'policies', 'privacy', 'settings', 'stories', 'ufi',
  ]);
  const TIME_RE = /^(\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm|s|m|h|d|w|y|sec|secs|min|mins|hr|hrs|wk|wks|yr|yrs)|vừa xong|just now|hôm qua|yesterday)$/i;
  const UI_WORDS = new Set([
    'thích', 'phản hồi', 'trả lời', 'like', 'reply', 'share', 'chia sẻ', 'xem thêm', 'see more', 'đã chỉnh sửa', 'edited', 'tác giả',
    'author', 'top fan', 'fan cứng', 'theo dõi', 'follow', 'ẩn', 'hide', 'xem bản dịch', 'see translation', 'dịch', 'translate',
    'quản trị viên', 'admin', 'người kiểm duyệt', 'moderator', 'đã ghim', 'pinned',
  ]);
  const COMMENT_LABEL = /^(bình luận|phản hồi|trả lời|comment|reply)\b/i;

  /** Đọc ID / username từ link trang cá nhân. Trả về null nếu không phải link người dùng. */
  function parseProfile(href) {
    let u;
    try {
      u = new URL(href, 'https://www.facebook.com');
    } catch (e) {
      return null;
    }
    if (!FB_HOST.test(u.hostname)) return null;
    const path = u.pathname.replace(/\/+$/, '');
    if (path === '/profile.php') {
      const id = u.searchParams.get('id');
      return id ? { id, url: `https://www.facebook.com/profile.php?id=${id}` } : null;
    }
    let m = path.match(/^\/groups\/[^/]+\/user\/(\d+)$/);
    if (m) return { id: m[1], url: `https://www.facebook.com/profile.php?id=${m[1]}` };
    m = path.match(/^\/people\/[^/]+\/(\d+)$/);
    if (m) return { id: m[1], url: `https://www.facebook.com/profile.php?id=${m[1]}` };
    const seg = path.split('/').filter(Boolean);
    if (seg.length === 1 && !RESERVED.has(seg[0].toLowerCase()) && /^[A-Za-z0-9.\-_]{2,}$/.test(seg[0])) {
      return { id: seg[0], url: `https://www.facebook.com/${seg[0]}` };
    }
    return null;
  }

  /** ID bình luận từ link (comment_id / reply_comment_id) */
  function commentIdFrom(links) {
    let id = null;
    for (const a of links) {
      try {
        const u = new URL(a.getAttribute('href') || '', 'https://www.facebook.com');
        const reply = u.searchParams.get('reply_comment_id');
        if (reply) return reply;
        id = id || u.searchParams.get('comment_id');
      } catch (e) {
        /* bỏ qua link lỗi */
      }
    }
    return id;
  }

  /** Lấy chữ của 1 phần tử, giữ emoji dạng ảnh (img alt) */
  function textOf(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) out += child.nodeValue;
      else if (child.nodeType === 1) {
        if (child.tagName === 'IMG') out += child.getAttribute('alt') || '';
        else if (child.tagName === 'BR') out += ' ';
        else out += textOf(child);
      }
    }
    return out;
  }

  const clean = (s) => s.replace(/\s+/g, ' ').trim();
  const isNoise = (t, author) => !t || TIME_RE.test(t) || UI_WORDS.has(t.toLowerCase()) || t === author;

  /** Phần tử con thuộc riêng bình luận này (không tính các phản hồi lồng bên trong) */
  function ownNodes(el, selector) {
    return Array.from(el.querySelectorAll(selector)).filter((n) => n.closest('[role="article"]') === el);
  }

  /** Các phần tử bình luận trên trang */
  function findCommentArticles(doc) {
    return Array.from(doc.querySelectorAll('[role="article"]')).filter((el) => {
      if (el.querySelector('video')) return false; // bài đăng / video chính, không phải bình luận
      const label = el.getAttribute('aria-label') || '';
      if (COMMENT_LABEL.test(label)) return true;
      return ownNodes(el, 'a[href*="comment_id="]').length > 0;
    });
  }

  /** Đọc 1 bình luận. Trả về null nếu chưa đủ dữ liệu (đang tải) hoặc không phải bình luận chữ. */
  function extractComment(el) {
    const links = ownNodes(el, 'a[href]');
    let author = null;
    for (const a of links) {
      const name = clean(textOf(a));
      if (!name || TIME_RE.test(name) || UI_WORDS.has(name.toLowerCase())) continue;
      const prof = parseProfile(a.getAttribute('href') || '');
      if (!prof) continue;
      author = { name: name.slice(0, 100), id: prof.id, url: prof.url };
      break;
    }
    if (!author) {
      const m = (el.getAttribute('aria-label') || '').match(/^(?:bình luận của|phản hồi của|trả lời của|comment by|reply by)\s+(.+?)(?:\s+\d+\s+\S+(?:\s+(?:trước|ago))?)?$/i);
      if (!m) return null;
      author = { name: clean(m[1]).slice(0, 100) };
    }

    // Ảnh đại diện
    const img = ownNodes(el, 'image')[0];
    const imgTag = ownNodes(el, 'img').find((i) => (i.getAttribute('src') || '').startsWith('http') && !(i.getAttribute('alt') || '').trim());
    const avatar = (img && (img.getAttribute('xlink:href') || img.getAttribute('href'))) || (imgTag && imgTag.getAttribute('src')) || undefined;
    if (avatar) author.avatar = avatar;

    // Nội dung: các khối dir="auto" không nằm trong link / nút, lấy khối trong cùng để không lặp chữ
    const blocks = ownNodes(el, '[dir="auto"]').filter(
      (n) => !n.closest('a') && !n.closest('[role="button"]') && !n.querySelector('[dir="auto"]'),
    );
    const parts = [];
    for (const b of blocks) {
      const t = clean(textOf(b));
      if (!isNoise(t, author.name) && !parts.includes(t)) parts.push(t);
    }
    const text = clean(parts.join(' '));
    if (!text) return null;
    return { id: commentIdFrom(links) || undefined, author, text: text.slice(0, 2000) };
  }

  /** "1,2K" -> 1200 ; "1.234" -> 1234 ; "12 N" -> 12000 ; "1,5 Tr" -> 1500000 */
  function parseCount(raw) {
    const m = String(raw).trim().match(/^([\d.,]+)\s*(k|n|nghìn|ngàn|tr|triệu|m)?$/i);
    if (!m) return null;
    const unit = (m[2] || '').toLowerCase();
    let num = m[1];
    if (unit) num = num.replace(',', '.');
    else num = num.replace(/[.,](?=\d{3}(\D|$))/g, '');
    const v = parseFloat(num);
    if (!isFinite(v)) return null;
    const mult = unit === 'k' || unit === 'n' || unit === 'nghìn' || unit === 'ngàn' ? 1e3 : unit === 'tr' || unit === 'triệu' || unit === 'm' ? 1e6 : 1;
    return Math.round(v * mult);
  }

  /** Số người đang xem (nếu trang có hiện) */
  function detectViewers(doc) {
    const re = /^([\d.,]+\s*(?:k|n|nghìn|ngàn|tr|triệu|m)?)\s*(?:người đang xem|đang xem|watching|viewers?)$/i;
    for (const el of doc.querySelectorAll('span, div')) {
      if (el.childElementCount > 2) continue;
      const t = clean(el.textContent || '');
      if (t.length > 40) continue;
      const m = t.match(re);
      if (m) {
        const v = parseCount(m[1]);
        if (v !== null) return v;
      }
    }
    return null;
  }

  /** Khoá chống trùng cho 1 bình luận */
  function commentKey(c) {
    return c.id ? `id:${c.id}` : `h:${c.author.id || c.author.name}|${c.text}`;
  }

  root.CheckliveFB = { parseProfile, commentIdFrom, extractComment, findCommentArticles, detectViewers, parseCount, commentKey, textOf };
})(typeof window !== 'undefined' ? window : globalThis);
