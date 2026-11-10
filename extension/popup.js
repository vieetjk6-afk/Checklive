/* Popup: cài đặt server + mã kết nối, bật / tắt gửi bình luận cho tab đang mở. */
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const params = new URLSearchParams(location.search);
let tabId = null;
let running = false;

function showWho(r) {
  const el = $('who');
  if (!r) return (el.textContent = '');
  if (!r.ok) {
    el.className = 'muted err';
    el.textContent = `✕ ${r.error}`;
    return;
  }
  const w = r.who;
  el.className = 'muted ok';
  el.textContent = `✓ Kênh "${w.channel.name}" · ${w.shopName}` + (w.sessionTitle ? ` · Phiên: ${w.sessionTitle}` : ' · Chưa có phiên live đang chạy');
}

async function refresh() {
  const r = await send({ type: 'popup:state', tabId });
  if (!$('server').value) $('server').value = r.settings.server || '';
  if (!$('token').value) $('token').value = r.settings.token || '';
  $('skip').checked = r.settings.skipExisting !== false;
  if (!tabId) return;
  running = !!(r.tab && r.tab.running);
  $('toggle').textContent = running ? '■ Dừng gửi bình luận' : '▶ Bắt đầu gửi bình luận';
  $('toggle').classList.toggle('stop', running);
  $('sent').textContent = r.tab ? r.tab.sent : 0;
  $('detected').textContent = r.page ? (r.page.detected >= 0 ? r.page.detected : '?') : '–';
  const st = $('status');
  if (!running) {
    st.className = 'muted';
    st.textContent = r.page && r.page.detected === 0 ? 'Chưa thấy bình luận nào trên trang. Mở khung bình luận của video live.' : '';
  } else if (r.tab.lastError) {
    st.className = 'muted err';
    st.textContent = `✕ ${r.tab.lastError}`;
  } else if (r.tab.remoteRunning === false) {
    st.className = 'muted err';
    st.textContent = r.tab.message || 'Kênh chưa nằm trong phiên live đang chạy trên Checklive.';
  } else if (r.tab.lastOkAt) {
    st.className = 'muted ok';
    st.textContent = `✓ Đang gửi${r.tab.sessionTitle ? ` vào phiên "${r.tab.sessionTitle}"` : ''} · lần cuối ${new Date(r.tab.lastOkAt).toLocaleTimeString('vi-VN')}`;
  } else {
    st.className = 'muted';
    st.textContent = 'Đang kết nối…';
  }
}

async function init() {
  if (params.get('tabId')) {
    tabId = Number(params.get('tabId'));
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https:\/\/([a-z0-9-]+\.)?facebook\.com\//i.test(tab.url)) tabId = tab.id;
  }
  $('fb').hidden = !tabId;
  $('notfb').hidden = !!tabId;
  await refresh();
  if ($('token').value) showWho(await send({ type: 'popup:whoami' }));
  setInterval(refresh, 1500);
}

$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  showWho(await send({ type: 'popup:save', server: $('server').value.trim(), token: $('token').value.trim(), skipExisting: $('skip').checked }));
  $('save').disabled = false;
});

$('toggle').addEventListener('click', async () => {
  $('toggle').disabled = true;
  const r = await send({ type: running ? 'popup:stop' : 'popup:start', tabId });
  if (r && r.ok === false) {
    $('status').className = 'muted err';
    $('status').textContent = `✕ ${r.error}`;
  }
  await refresh();
  $('toggle').disabled = false;
});

init();
