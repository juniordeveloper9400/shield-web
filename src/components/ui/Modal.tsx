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
  const bodyMaxHeight =
    size === 'full' ? 'max-h-[86vh]' : size === 'md' ? 'max-h-[60vh]' : 'max-h-[74vh]';
  // 'full' hands its own scrolling to its content instead of scrolling the
  // whole body as one block — the prescription intake screen keeps its card
  // and script image fixed in place and only scrolls the table under them,
  // which position: sticky can't guarantee once the fixed part is taller
  // than the viewport. flex + overflow-hidden here, and the content itself
  // marks which of its own sections scrolls (see PrescriptionReviewModal).
  const bodyClass =
    size === 'full'
      ? `flex ${bodyMaxHeight} flex-col overflow-hidden px-5 py-4`
      : `${bodyMaxHeight} overflow-y-auto px-5 py-4`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 w-full ${widthClass} overflow-hidden rounded-xl bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
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
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
