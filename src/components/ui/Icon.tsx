import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'dashboard'
  | 'stores'
  | 'products'
  | 'orders'
  | 'prescriptions'
  | 'appointments'
  | 'labs'
  | 'admins'
  | 'wallet'
  | 'menu'
  | 'close'
  | 'search'
  | 'logout'
  | 'chevron-down'
  | 'check'
  | 'plus'
  | 'external'
  | 'alert';

const ICONS: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  stores: (
    <>
      <path d="M4 9h16l-1-4H5L4 9Z" />
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  products: (
    <>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </>
  ),
  orders: (
    <>
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h6" />
    </>
  ),
  prescriptions: (
    <>
      <path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M13 4v6h6" />
      <path d="M8 12h3.5a2 2 0 0 1 0 4H8v-4Zm0 4 4 4" />
    </>
  ),
  appointments: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  labs: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M7 16h10" />
    </>
  ),
  admins: (
    <>
      <path d="M12 3 5 6v5c0 4 2.9 7.4 7 8.5 4.1-1.1 7-4.5 7-8.5V6l-7-3Z" />
      <path d="M9 11.5 11 13.5 15 9.5" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <path d="M3 10h18" />
      <circle cx="16" cy="14" r="1" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  external: (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </>
  ),
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  className?: string;
}

export function Icon({ name, className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}
