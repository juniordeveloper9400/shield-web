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
  // 'full' fixes the WHOLE dialog (header + body + footer together) at
  // 97vh tall — a fixed height (h-), not a max-height, since a max only
  // caps how tall it's allowed to grow: with content that doesn't happen
  // to need the full 97vh, the dialog would just shrink to fit instead of
  // actually filling the page the way a full-screen review screen should
  // read. Header and footer are shrink-0 (their natural size, never
  // shrunk); the body is the one flex-1 item, so it always gets exactly
  // "97vh minus however tall they really are".
  //
  // The body itself is ONE scrolling region (overflow-y-auto), same as
  // every other Modal size — not further split into its own nested
  // fixed/scrolling sub-regions. An earlier version of this tried keeping
  // the prescription intake card and script image fixed with only the
  // medicine table scrolling under them, which meant two independent
  // scrollbars on screen at once; simpler and what was actually wanted is
  // this whole screen reading as one continuous page with a single
  // scrollbar, so PrescriptionReviewModal's own content just flows
  // normally in here now.
  const dialogClass =
    size === 'full'
      ? `relative z-10 flex h-[97vh] w-full ${widthClass} flex-col overflow-hidden rounded-xl bg-white shadow-xl`
      : `relative z-10 w-full ${widthClass} overflow-hidden rounded-xl bg-white shadow-xl`;
  const headerClass =
    size === 'full'
      ? 'flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4'
      : 'flex items-center justify-between border-b border-slate-200 px-5 py-4';
  const bodyClass =
    size === 'full'
      ? 'min-h-0 flex-1 overflow-y-auto px-5 py-4'
      : `${bodyMaxHeight} overflow-y-auto px-5 py-4`;
  const footerClass =
    size === 'full'
      ? 'flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4'
      : 'flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${size === 'full' ? 'p-1.5' : 'p-4'}`}
    >
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
