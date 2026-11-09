import { useEffect, type ReactNode } from 'react';

/** Hộp thoại / ngăn kéo bên phải (trên điện thoại chiếm toàn màn hình) */
export default function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        role="dialog"
        className={`flex h-full w-full flex-col bg-white shadow-xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 flex-1 font-semibold">{title}</div>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
