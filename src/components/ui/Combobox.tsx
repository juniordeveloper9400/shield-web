import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface ComboboxOption {
  value: string;
  label: string;
}

/**
 * A searchable dropdown for a long option list (medicine Type, Intake
 * preset, Route & time — 20 to 40+ entries each) — a plain `<select>`'s
 * popup is drawn by the browser itself, outside the page's own layout, so
 * nothing here controls where it lands. Deep in a long, scrolled form that
 * shows up as the whole list opening flush against the top of the browser
 * window instead of near the field it belongs to (see the medicine Type
 * field this replaced).
 *
 * This one is a plain, styled panel positioned in JS from the trigger's own
 * on-screen position (`fixed`, viewport coordinates — never clipped by the
 * modal's own scrolling body), flipped above the trigger when there isn't
 * room below, and capped to a height that always fits the viewport. A search
 * box at the top narrows the list by typing, so a 40-item list is still a
 * few keystrokes away rather than a long scroll.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  searchPlaceholder = 'Search…',
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    openUp: boolean;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The currently-selected option's own button, so opening the panel can
  // scroll straight to it — a selection near the end of a 40-item list would
  // otherwise start scrolled to the top, off-screen, every time it reopens.
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  // A value set before this field had this exact option list (an old
  // free-typed entry, or one added on a different browser) still shows as
  // itself rather than silently reverting to the placeholder.
  const selected = value
    ? (options.find((o) => o.value === value) ?? { value, label: value })
    : undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const PANEL_HEIGHT = 240;

  function openPanel() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < PANEL_HEIGHT && rect.top > spaceBelow;
    setPos({
      top: openUp ? rect.top : rect.bottom,
      left: rect.left,
      width: rect.width,
      openUp,
    });
    setQuery('');
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        panelRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    // Scrolling the page, or the modal's own scrolling body, moves the
    // trigger out from under a `fixed`-position panel that was placed from a
    // one-time measurement — close rather than let it float over the wrong
    // spot. `capture: true` is what catches scrolling on the modal's inner
    // container, not just the window; the same capture phase also sees the
    // panel's own option list scrolling (browsing a long list), which must
    // NOT close it — excluded explicitly below.
    function onScroll(e: Event) {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Once the panel (and its options) have rendered, jump straight to
  // whichever one is currently selected, so re-opening a field already set
  // deep in the list doesn't start scrolled to the top.
  useEffect(() => {
    if (open) selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-left text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 ${className}`}
      >
        <span
          className={`truncate ${selected ? 'text-slate-800' : 'text-slate-400'}`}
        >
          {selected ? selected.label : placeholder}
        </span>
        <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: pos.openUp ? undefined : pos.top + 4,
            bottom: pos.openUp ? window.innerHeight - pos.top + 4 : undefined,
            left: pos.left,
            width: pos.width,
          }}
          className="z-50 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          <div className="shrink-0 border-b border-slate-100 p-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-brand-500"
            />
          </div>
          <div className="overflow-y-auto py-1" style={{ maxHeight: PANEL_HEIGHT - 44 }}>
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">No matches.</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  ref={o.value === value ? selectedItemRef : undefined}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${
                    o.value === value
                      ? 'bg-brand-50 font-medium text-brand-700'
                      : 'text-slate-700'
                  }`}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
