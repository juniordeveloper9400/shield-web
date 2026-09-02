import { NavLink } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { allowedModules, ROLE_LABELS } from '@/config/permissions';
import { Icon } from '@/components/ui/Icon';

export function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  if (!user) return null;

  const items = allowedModules(user.role);

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
          <img
            src="/shield_mark.png"
            alt="SHIELD"
            className="h-9 w-9 rounded-lg object-contain"
          />
          <div>
            <p className="text-sm font-semibold text-slate-900">SHIELD Admin</p>
            <p className="text-xs text-slate-400">Operations console</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-accent-100 text-accent-800'
                    : 'text-slate-600 hover:bg-accent-50 hover:text-accent-800'
                }`
              }
            >
              <Icon name={item.icon} className="h-5 w-5 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-3">
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
            Signed in as{' '}
            <span className="font-semibold text-slate-700">
              {ROLE_LABELS[user.role]}
            </span>
            <span className="mt-0.5 block text-slate-400">
              {items.length} module{items.length === 1 ? '' : 's'} available
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
