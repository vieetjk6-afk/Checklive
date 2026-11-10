import { useState } from 'react';
import { api } from '../lib/api';
import type { Channel } from '../lib/types';

/** Mã kết nối + hướng dẫn cài tiện ích Chrome cho 1 kênh Facebook */
export default function ExtensionGuide({ channel, onChanged }: { channel: Channel; onChanged: () => void }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const token = channel.connectorToken ?? '';

  const copy = async () => {
    await navigator.clipboard?.writeText(token).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const regenerate = async () => {
    if (!confirm('Tạo mã mới? Tiện ích đang dùng mã cũ sẽ ngừng gửi được, cần dán mã mới vào tiện ích.')) return;
    await api(`/api/channels/${channel.id}/token`, { method: 'POST' }).catch((e) => alert(e.message));
    onChanged();
  };

  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-700">Mã kết nối:</span>
        <code className="min-w-0 max-w-[220px] truncate rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">{show ? token : `${token.slice(0, 8)}••••••••`}</code>
        <button className="text-indigo-700 hover:underline" onClick={() => setShow(!show)}>{show ? 'Ẩn' : 'Hiện'}</button>
        <button className="text-indigo-700 hover:underline" onClick={copy}>{copied ? 'Đã chép ✓' : 'Sao chép'}</button>
        <button className="text-slate-500 hover:underline" onClick={regenerate}>Đổi mã</button>
      </div>
      <details className="mt-1.5">
        <summary className="cursor-pointer font-medium text-indigo-700">Cách cài & dùng tiện ích Chrome</summary>
        <ol className="mt-1 list-decimal space-y-1 pl-4 text-slate-600">
          <li>
            <a className="font-medium text-indigo-700 underline" href="/downloads/checklive-connector.zip">Tải tiện ích (.zip)</a> rồi giải nén ra 1 thư mục.
          </li>
          <li>Mở Chrome, vào <code>chrome://extensions</code>, bật <b>Chế độ dành cho nhà phát triển</b>, bấm <b>Tải tiện ích đã giải nén</b> và chọn thư mục vừa giải nén.</li>
          <li>Bấm biểu tượng Checklive trên thanh công cụ, dán <b>mã kết nối</b> ở trên, bấm "Lưu & kiểm tra kết nối".</li>
          <li>Trên Checklive: tạo phiên live có kênh này và bấm <b>Bắt đầu theo dõi</b>.</li>
          <li>Mở trang live trên Facebook (hiện khung bình luận), bấm biểu tượng tiện ích → <b>Bắt đầu gửi bình luận</b>. Giữ tab mở suốt buổi live.</li>
        </ol>
        <p className="mt-1 text-slate-500">
          Tiện ích chỉ đọc bình luận đang hiển thị trên trang, không bấm hay đăng gì lên Facebook. Facebook không cho biết ai like / share qua cách này.
        </p>
      </details>
    </div>
  );
}
