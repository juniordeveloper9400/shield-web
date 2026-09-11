import { useState } from 'react';
import { Modal } from './Modal';

/**
 * A small clickable preview of a member-uploaded payment receipt, for list
 * rows where the full {@link ../../pages/ActivationDetailPage} isn't open —
 * the privilege-plan approval list and a member's Plan details tab. Tapping
 * it opens the same image full size in a modal, with a link out to the raw
 * file, so a reviewer never has to drill into the detail page just to check
 * what was uploaded.
 */
export function ReceiptThumb({
  image,
  title = 'Payment receipt',
}: {
  /** `PrivilegeActivation.receiptImage` — '' when none was uploaded. */
  image: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!image) {
    return <span className="text-xs text-slate-400">No receipt</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Rows this sits in are often clickable themselves; the receipt
          // preview is its own destination.
          e.stopPropagation();
          setOpen(true);
        }}
        title="View payment receipt"
        className="block h-10 w-10 shrink-0 overflow-hidden rounded-md border border-slate-200 transition hover:border-brand-300 hover:shadow-sm"
      >
        <img
          src={image}
          alt="Payment receipt thumbnail"
          className="h-full w-full bg-slate-50 object-cover"
        />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <a
          href={image}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-lg border border-slate-200"
        >
          <img
            src={image}
            alt="Payment receipt uploaded by the member"
            className="max-h-[70vh] w-full bg-slate-50 object-contain"
          />
        </a>
        <p className="mt-2 text-xs text-slate-400">
          Tap the image to open it full size in a new tab.
        </p>
      </Modal>
    </>
  );
}
