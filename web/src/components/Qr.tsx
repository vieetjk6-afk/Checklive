import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** Hiển thị mã QR từ chuỗi bất kỳ (link, nội dung VietQR…) */
export default function Qr({ value, size = 180, className = '' }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [value, size]);
  if (!src) return <div style={{ width: size, height: size }} className={`rounded bg-slate-100 ${className}`} />;
  return <img src={src} width={size} height={size} alt="Mã QR" className={className} />;
}
