import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { allowedModules, landingPath, ROLE_LABELS } from '@/config/permissions';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';

export default function NoAccessPage() {
  const { user } = useAuth();
  if (!user) return null;

  const modules = allowedModules(user.role);

  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-50 text-rose-500">
        <Icon name="alert" className="h-7 w-7" />
      </span>
      <h1 className="mt-4 text-xl font-semibold text-slate-900">
        This page isn&apos;t available for your login
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        You&apos;re signed in as{' '}
        <span className="font-medium text-slate-700">{ROLE_LABELS[user.role]}</span>{' '}
        (<span className="text-slate-700">{user.loginId}</span>). That role can
        open the modules below.
      </p>

      <Card className="mt-6 divide-y divide-slate-100 text-left">
        {modules.map((m) => (
          <Link
            key={m.key}
            to={m.path}
            className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <Icon name={m.icon} className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-medium text-slate-800">
                {m.label}
              </span>
              <span className="block text-xs text-slate-400">
                {m.description}
              </span>
            </span>
          </Link>
        ))}
      </Card>

      <Link
        to={landingPath(user.role)}
        className="mt-6 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        Go to my dashboard
      </Link>
    </div>
  );
}
