import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface UnsavedInfo {
  /** What's being edited, for the dialog's message — "this product",
   *  "this store", etc. */
  label: string;
  /** Saves the in-progress work. Resolve `true` once it's actually saved
   *  (the guard then clears itself and completes the navigation); resolve
   *  `false` or throw to keep the admin on the page, with the message
   *  shown to them. Omit entirely when there's nothing sensible to save
   *  outside the form itself — the dialog then only offers "Leave without
   *  saving" / "Cancel", no "Save".
   */
  onSave?: () => Promise<boolean>;
}

interface UnsavedChangesContextValue {
  /** Call with details once a form has unsaved changes, and with `null` the
   *  moment it's saved, cancelled, or closed — the one flag every sidebar
   *  link and the browser's own unload prompt both check. */
  setUnsaved: (info: UnsavedInfo | null) => void;
  /** What the Sidebar (or anything else navigating within the app) calls
   *  instead of `navigate()` directly — goes straight through when nothing
   *  is unsaved, otherwise asks first. */
  guardedNavigate: (to: string) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function useUnsavedChanges() {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) throw new Error('useUnsavedChanges must be used within UnsavedChangesProvider');
  return ctx;
}

/**
 * One hook a form calls with its own dirty flag — everything else (the
 * dialog, the sidebar guard, the browser's own "leave site?" prompt) is
 * handled centrally. A page with an "Add"/"Edit" form calls this with
 * `isDirty` true while there's something that would be lost, and an
 * optional `onSave`:
 *
 * ```tsx
 * useUnsavedChangesGuard(adding && hasChanges, {
 *   label: 'this product',
 *   onSave: async () => { await saveNew(); return true; },
 * });
 * ```
 */
export function useUnsavedChangesGuard(
  isDirty: boolean,
  info: Omit<UnsavedInfo, 'label'> & { label: string },
) {
  const { setUnsaved } = useUnsavedChanges();
  useEffect(() => {
    setUnsaved(isDirty ? info : null);
    // Only the dirty flag and the label identify a meaningfully different
    // registration; onSave is a fresh closure every render and would
    // otherwise re-fire this on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, info.label]);
  // Clears on unmount too — leaving the page by any route already handled
  // (Cancel, a successful save) must not leave a stale guard behind.
  useEffect(() => () => setUnsaved(null), [setUnsaved]);
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const unsavedRef = useRef<UnsavedInfo | null>(null);
  const [dialogFor, setDialogFor] = useState<{ info: UnsavedInfo; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setUnsaved = useCallback((info: UnsavedInfo | null) => {
    unsavedRef.current = info;
  }, []);

  const guardedNavigate = useCallback(
    (to: string) => {
      if (!unsavedRef.current) {
        navigate(to);
        return;
      }
      setError(null);
      setDialogFor({ info: unsavedRef.current, to });
    },
    [navigate],
  );

  // Refresh, close the tab, type a new URL, click an external link —
  // anything that isn't in-app navigation. The browser shows its own
  // generic "leave site?" wording; no browser lets a page customise that
  // text any more (a long-standing anti-abuse restriction), so the
  // specific label/message only shows in our own dialog above.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!unsavedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  function close() {
    if (busy) return;
    setDialogFor(null);
    setError(null);
  }

  function leaveWithoutSaving() {
    if (!dialogFor) return;
    unsavedRef.current = null;
    const { to } = dialogFor;
    setDialogFor(null);
    navigate(to);
  }

  async function saveAndLeave() {
    if (!dialogFor?.info.onSave) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await dialogFor.info.onSave();
      if (!saved) {
        setBusy(false);
        return;
      }
      unsavedRef.current = null;
      const { to } = dialogFor;
      setDialogFor(null);
      setBusy(false);
      navigate(to);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Try again.');
      setBusy(false);
    }
  }

  return (
    <UnsavedChangesContext.Provider value={{ setUnsaved, guardedNavigate }}>
      {children}
      <Modal
        open={dialogFor !== null}
        onClose={close}
        title="Leave without saving?"
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={close}>
              Stay here
            </Button>
            <Button variant="danger" disabled={busy} onClick={leaveWithoutSaving}>
              Leave without saving
            </Button>
            {dialogFor?.info.onSave && (
              <Button variant="primary" disabled={busy} onClick={() => void saveAndLeave()}>
                {busy ? 'Saving…' : 'Save and continue later'}
              </Button>
            )}
          </>
        }
      >
        <p className="text-sm text-slate-600">
          You have unsaved changes on {dialogFor?.info.label ?? 'this page'}.{' '}
          {dialogFor?.info.onSave
            ? 'Save it to come back and finish later, or leave without saving.'
            : 'Leaving now loses them.'}
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
      </Modal>
    </UnsavedChangesContext.Provider>
  );
}
