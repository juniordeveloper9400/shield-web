import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** `md` (default, ~512px) · `lg` (~672px) · `xl` (~896px, for a split view)
   *  · `full` (near-viewport-filling, for a page-like split view with its
   *  own scrolling table — the prescription intake screen). */
  size?: 'md' | 'lg' | 'xl' | 'full';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const widthClass =
    size === 'full'
      ? 'w-[96vw] max-w-[1600px]'
      : size === 'xl'
        ? 'max-w-4xl'
        : size === 'lg'
          ? 'max-w-2xl'
          : 'max-w-lg';
  const bodyMaxHeight = size === 'md' ? 'max-h-[60vh]' : 'max-h-[74vh]';
  // 'full' caps the WHOLE dialog (header + body + footer together) at
  // 92vh and makes it a flex column, instead of only capping the body at
  // 86vh on its own — capping just the body left the header and footer's
  // own height added on top of that 86vh with nothing accounting for the
  // total, so the dialog as a whole could still end up taller than the
  // viewport with no way to reach whatever that pushed off the bottom
  // (the footer, or the last of the body). Header and footer are shrink-0
  // (their natural size, never shrunk); the body is the one flex-1 item,
  // so it always gets exactly "whatever's left" after their real heights
  // are subtracted — never a fixed guess. The prescription intake screen
  // then does the same thing one level deeper inside that body (see
  // PrescriptionReviewModal) to keep its card and script image fixed and
  // scroll only the table under them.
  const dialogClass =
    size === 'full'
      ? `relative z-10 flex max-h-[92vh] w-full ${widthClass} flex-col overflow-hidden rounded-xl bg-white shadow-xl`
      : `relative z-10 w-full ${widthClass} overflow-hidden rounded-xl bg-white shadow-xl`;
  const headerClass =
    size === 'full'
      ? 'flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4'
      : 'flex items-center justify-between border-b border-slate-200 px-5 py-4';
  const bodyClass =
    size === 'full'
      ? 'flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4'
      : `${bodyMaxHeight} overflow-y-auto px-5 py-4`;
  const footerClass =
    size === 'full'
      ? 'flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4'
      : 'flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div role="dialog" aria-modal="true" className={dialogClass}>
        <div className={headerClass}>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className={bodyClass}>
          {children}
        </div>
        {footer && <div className={footerClass}>{footer}</div>}
      </div>
    </div>
  );
}
