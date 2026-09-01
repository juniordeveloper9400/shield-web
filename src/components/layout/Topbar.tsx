import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { MODULES, ROLE_LABELS } from '@/config/permissions';
import { Icon } from '@/components/ui/Icon';
import { initials } from '@/lib/format';

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;

  const currentModule = MODULES.find((m) => location.pathname.startsWith(m.path));

  async function handleSignOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          aria-label="Open menu"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
        >
          <Icon name="menu" />
        </button>
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {currentModule?.label ?? 'Shield Admin'}
          </p>
          {currentModule && (
            <p className="hidden text-xs text-slate-400 sm:block">
              {currentModule.description}
            </p>
          )}
        </div>
      </div>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-slate-100"
        >
          <span
            className="grid h-9 w-9 place-items-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: user.avatarColor }}
          >
            {initials(user.name)}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-medium text-slate-900">
              {user.name}
            </span>
            <span className="block text-xs text-slate-400">
              {ROLE_LABELS[user.role]}
            </span>
          </span>
          <Icon
            name="chevron-down"
            className="hidden h-4 w-4 text-slate-400 sm:block"
          />
        </button>

        {menuOpen && (
          <div className="absolute right-0 z-20 mt-2 w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="text-xs text-slate-400">Signed in as</p>
              <p className="truncate text-sm font-medium text-slate-700">{user.name}</p>
              <p className="mt-1 truncate text-xs text-slate-400">{user.loginId}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
            >
              <Icon name="logout" className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
