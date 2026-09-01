import type { Tone } from '@/components/ui/Badge';

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Maps any status string used across the app to a Badge colour. */
const STATUS_TONE: Record<string, Tone> = {
  approved: 'green',
  published: 'green',
  active: 'green',
  confirmed: 'blue',
  completed: 'green',
  pending: 'amber',
  requested: 'amber',
  rejected: 'red',
  cancelled: 'red',
  suspended: 'red',
  inactive: 'gray',
  // Orders
  processing: 'amber',
  out_for_delivery: 'blue',
  delivered: 'green',
  // Prescriptions
  awaiting_review: 'amber',
  read: 'blue',
  in_cart: 'violet',
  ordered: 'green',
  // Lab bookings
  sample_collected: 'violet',
  report_ready: 'green',
};

export function toneForStatus(status: string): Tone {
  return STATUS_TONE[status] ?? 'gray';
}

export function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
