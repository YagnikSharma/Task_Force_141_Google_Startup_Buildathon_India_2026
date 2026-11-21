import Mark from './Mark';
import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BarChart3, Baby, HeartHandshake, Home, LogOut, Map, Menu, Route, ShieldAlert, ShieldCheck, Users, X, TriangleAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type Item = { to: string; label: string; icon: React.ComponentType<{ className?: string }> };

/** Navigation per role. The first items also become the phone tab bar. */
function itemsFor(role?: string): Item[] {
  if (role === 'responder') {
    return [
      { to: '/responder', label: 'Queue', icon: Activity },
      { to: '/map', label: 'Live map', icon: Map },
      { to: '/community', label: 'Hazards', icon: TriangleAlert },
      { to: '/safe-route', label: 'Safe Route', icon: Route },
    ];
  }
  if (role === 'admin') {
    return [
      { to: '/admin', label: 'Admin', icon: ShieldCheck },
      { to: '/community', label: 'Insights', icon: BarChart3 },
      { to: '/map', label: 'Live map', icon: Map },
      { to: '/safe-route', label: 'Safe Route', icon: Route },
    ];
  }
  return [
    { to: '/dashboard', label: 'Home', icon: Home },
    { to: '/map', label: 'Live map', icon: Map },
    { to: '/safe-route', label: 'Safe Route', icon: Route },
    { to: '/contacts', label: 'Contacts', icon: Users },
    { to: '/child-safety', label: 'Child commute', icon: Baby },
    { to: '/elder-care', label: 'Elder care', icon: HeartHandshake },
    { to: '/community', label: 'Community', icon: BarChart3 },
  ];
}

function initials(name?: string) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const items = itemsFor(user?.role);
  const isResident = !!user && user.role !== 'responder' && user.role !== 'admin';

  useEffect(() => setSheetOpen(false), [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-full text-sm font-medium transition ${
      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
    }`;

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <Link to={user ? items[0].to : '/'} className="flex items-center gap-2.5 shrink-0">
            <Mark className="w-9 h-9" />
            <div className="leading-none">
              <span className="block font-display text-[19px] font-bold tracking-tight text-slate-900">nsin</span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">safety network</span>
            </div>
          </Link>

          {/* Desktop links */}
          <nav className="hidden lg:flex items-center gap-0.5">
            {user ? (
              <>
                {items.slice(0, isResident ? 6 : 4).map((it) => (
                  <NavLink key={it.to} to={it.to} className={linkCls}>{it.label}</NavLink>
                ))}
              </>
            ) : (
              <>
                <a href="#how-it-works" className="px-3 py-2 rounded-full text-sm font-medium text-slate-600 hover:bg-slate-100">How it works</a>
                <a href="#features" className="px-3 py-2 rounded-full text-sm font-medium text-slate-600 hover:bg-slate-100">Features</a>
                <a href="#privacy" className="px-3 py-2 rounded-full text-sm font-medium text-slate-600 hover:bg-slate-100">Privacy</a>
                <NavLink to="/safe-route" className={linkCls}>Safe Route</NavLink>
                <a href="https://nsin-landing.web.app" target="_blank" rel="noopener" className="px-3 py-2 rounded-full text-sm font-semibold text-brand-700 hover:bg-brand-50">Our story ↗</a>
              </>
            )}
          </nav>

          <div className="flex items-center gap-2">
            {user ? (
              <>
                {isResident && (
                  <Link to="/sos" className="hidden lg:inline-flex btn-danger !py-2 !px-4">
                    <ShieldAlert className="w-4 h-4" /> SOS
                  </Link>
                )}
                <button
                  onClick={() => setSheetOpen(true)}
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-white pl-1 pr-2 py-1 hover:bg-slate-50 transition"
                  aria-label="Open menu"
                >
                  <span className="grid place-items-center w-8 h-8 rounded-full bg-brand-500 text-white text-xs font-bold">{initials(user.full_name)}</span>
                  <span className="hidden sm:block text-left leading-tight pr-1">
                    <span className="block text-[13px] font-semibold text-slate-800 max-w-[160px] truncate">{user.full_name}</span>
                    <span className="block text-[11px] capitalize text-slate-500">{user.role}</span>
                  </span>
                  <Menu className="w-4 h-4 text-slate-500" />
                </button>
              </>
            ) : (
              <>
                <Link to="/auth?mode=login" className="btn-ghost !px-4 !py-2">Sign in</Link>
                <Link to="/auth?mode=register" className="btn-primary !px-4 !py-2 hidden sm:inline-flex">Join the network</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Menu sheet (phone + desktop): every page for this role, plus sign out */}
      {sheetOpen && user && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setSheetOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-[86%] max-w-sm bg-white shadow-2xl flex flex-col animate-fade-up">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <span className="grid place-items-center w-11 h-11 rounded-full bg-brand-500 text-white font-bold">{initials(user.full_name)}</span>
                <div className="leading-tight">
                  <div className="font-semibold text-slate-900">{user.full_name}</div>
                  <div className="text-xs capitalize text-slate-500">{user.role}</div>
                </div>
              </div>
              <button onClick={() => setSheetOpen(false)} className="p-2 rounded-full hover:bg-slate-100" aria-label="Close menu">
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {isResident && (
                <Link to="/sos" className="flex items-center gap-3 rounded-xl px-3 py-3 bg-red-50 text-red-700 font-semibold">
                  <ShieldAlert className="w-5 h-5" /> Send SOS
                </Link>
              )}
              {items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium transition ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`
                  }
                >
                  <it.icon className="w-5 h-5" /> {it.label}
                </NavLink>
              ))}
            </nav>
            <div className="p-4 border-t border-slate-100 space-y-3">
              <a href="https://nsin-landing.web.app" target="_blank" rel="noopener" className="flex items-center justify-center gap-2 rounded-xl bg-brand-50 py-3 text-sm font-semibold text-brand-700">
                About NSIN: research, pitch, team ↗
              </a>
              <a href="tel:112" className="flex items-center justify-center gap-2 rounded-xl border border-red-200 py-3 text-sm font-semibold text-red-700">
                Call 112 (national emergency)
              </a>
              <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phone tab bar: the four main pages, with SOS in the middle for residents */}
      {user && <TabBar items={items.slice(0, 4)} sos={isResident} onMore={() => setSheetOpen(true)} />}
    </>
  );
};

const TabBar: React.FC<{ items: Item[]; sos: boolean; onMore: () => void }> = ({ items, sos, onMore }) => {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 text-[11px] font-medium transition ${isActive ? 'text-brand-600' : 'text-slate-500'}`;
  const left = sos ? items.slice(0, 2) : items.slice(0, 2);
  const right = sos ? items.slice(2, 3) : items.slice(2, 4);
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Main"
    >
      <div className="relative flex items-end h-[64px] px-1">
        {left.map((it) => (
          <NavLink key={it.to} to={it.to} className={tab}>
            <it.icon className="w-[22px] h-[22px]" />
            {it.label}
          </NavLink>
        ))}
        {sos && (
          <div className="flex-1 flex justify-center">
            <Link
              to="/sos"
              className="relative -mt-7 mb-1.5 grid place-items-center w-[64px] h-[64px] rounded-full bg-red-600 text-white shadow-sos ring-4 ring-white active:scale-95 transition"
              aria-label="Send SOS"
            >
              <span className="absolute inset-0 rounded-full bg-red-500 animate-sos-ring" aria-hidden="true" />
              <span className="relative text-[13px] font-extrabold tracking-wide">SOS</span>
            </Link>
          </div>
        )}
        {right.map((it) => (
          <NavLink key={it.to} to={it.to} className={tab}>
            <it.icon className="w-[22px] h-[22px]" />
            {it.label}
          </NavLink>
        ))}
        <button onClick={onMore} className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 text-[11px] font-medium text-slate-500">
          <Menu className="w-[22px] h-[22px]" />
          More
        </button>
      </div>
    </nav>
  );
};
