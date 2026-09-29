import { useCallback, useState, type ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  /** Defaults to "Confirm". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Red "danger" button instead of the brand-coloured "primary" one — use
   *  for anything that deletes, cancels or otherwise can't be undone. */
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}

/**
 * One confirmation dialog, shared by every Approve / Reject / Cancel /
 * Delete action in the console, so they all look and behave the same way
 * instead of each screen inventing its own "are you sure" — a click on
 * `ask(options)` opens the dialog; `options.onConfirm` only runs if the
 * person clicks the (labelled, colour-coded) confirm button, and its error
 * — if it throws — is shown right there instead of being lost.
 *
 * Render `dialog` once, anywhere in the calling component's JSX:
 *
 * ```tsx
 * const { ask, dialog } = useConfirmDialog();
 * ...
 * <Button onClick={() => ask({
 *   title: 'Cancel this order?',
 *   message: 'The customer will be notified. This cannot be undone.',
 *   confirmLabel: 'Cancel order',
 *   danger: true,
 *   onConfirm: () => cancelOrder(id),
 * })}>Cancel</Button>
 * ...
 * {dialog}
 * ```
 */
export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback((next: ConfirmOptions) => {
    setError(null);
    setOptions(next);
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setOptions(null);
    setError(null);
  }, [busy]);

  async function run() {
    if (!options) return;
    setBusy(true);
    setError(null);
    try {
      await options.onConfirm();
      setOptions(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <Modal open={options !== null} onClose={close} title={options?.title ?? ''} footer={
      <>
        <div className="flex-1" />
        <Button variant="secondary" disabled={busy} onClick={close}>
          {options?.cancelLabel ?? 'Cancel'}
        </Button>
        <Button variant={options?.danger ? 'danger' : 'primary'} disabled={busy} onClick={() => void run()}>
          {busy ? 'Working…' : (options?.confirmLabel ?? 'Confirm')}
        </Button>
      </>
    }>
      <p className="text-sm text-slate-600">{options?.message}</p>
      {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
    </Modal>
  );

  return { ask, dialog };
}
