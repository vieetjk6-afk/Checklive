import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import type { Me } from './lib/types';
import LoginPage from './pages/LoginPage';
import SessionsPage from './pages/SessionsPage';
import ChannelsPage from './pages/ChannelsPage';
import SessionPage from './pages/SessionPage';
import ProductsPage from './pages/ProductsPage';
import SettingsPage from './pages/SettingsPage';
import LookupPage from './pages/public/LookupPage';
import ConfirmPage from './pages/public/ConfirmPage';
import OverlayPage from './pages/public/OverlayPage';

/** Trang công khai cho khách / OBS: không cần đăng nhập */
const PUBLIC_PREFIXES = ['/s/', '/o/', '/overlay/'];

export default function App() {
  const { pathname } = useLocation();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return (
      <Routes>
        <Route path="/s/:publicId" element={<LookupPage />} />
        <Route path="/o/:token" element={<ConfirmPage />} />
        <Route path="/overlay/:publicId" element={<OverlayPage />} />
      </Routes>
    );
  }
  return <AdminApp />;
}

function AdminApp() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    api<Me>('/api/auth/me').then(setMe).catch(() => setMe(null));
  }, []);

  if (me === undefined) return <div className="p-8 text-slate-500">Đang tải…</div>;

  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to="/" replace /> : <LoginPage onLogin={setMe} />} />
      <Route path="/*" element={me ? <Shell me={me} onLogout={() => setMe(null)} /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}

function Shell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const navigate = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`;

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    onLogout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2.5">
          <NavLink to="/" className="mr-1 flex shrink-0 items-center gap-2 font-bold text-slate-900 sm:mr-3">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-rose-500 text-xs text-white">●</span>
            <span className="hidden sm:inline">Checklive</span>
          </NavLink>
          <nav className="no-scrollbar -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1">
            <NavLink to="/" end className={link}>Phiên live</NavLink>
            <NavLink to="/products" className={link}>Sản phẩm</NavLink>
            <NavLink to="/channels" className={link}>Kênh</NavLink>
            <NavLink to="/settings" className={link}>Cài đặt</NavLink>
          </nav>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <span className="hidden text-slate-500 sm:inline">{me.email}</span>
            <button className="btn-ghost whitespace-nowrap px-2.5 py-1.5" onClick={logout}>Thoát</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">
        <Routes>
          <Route path="/" element={<SessionsPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/sessions/:id" element={<SessionPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
