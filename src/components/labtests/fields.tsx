import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';

/**
 * The outlined controls the lab test form is built from: the label sits on the
 * field's top border, the way the laboratory's own LIS screens draw them, so
 * staff moving over from that software find every field where they expect it.
 */

const controlClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 pb-1.5 pt-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400 read-only:bg-slate-50';

export function LisField({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`relative block ${className}`}>
      <span className="absolute -top-2 left-2.5 z-10 bg-white px-1 text-[11px] font-medium leading-4 text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

/** A text field. Give it `suggestions` and it offers them as a dropdown while
 *  still accepting anything typed — the values are not a closed list. */
export function LisText({
  label,
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggestions?: string[];
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
}) {
  const listId = useId();
  return (
    <LisField label={label} className={className}>
      <input
        value={value}
        readOnly={readOnly}
        list={suggestions ? listId : undefined}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={controlClass}
      />
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </LisField>
  );
}

export interface ComboboxOption {
  id: string;
  value: string;
}

/**
 * A text field backed by a managed pick list: a dropdown sized to the field
 * itself (not the browser's own unstyled, full-width `<datalist>` popup),
 * still free to type anything into — plus, right there in the dropdown, a
 * rename and delete for each entry and an "Add" for whatever was just typed.
 * Renaming or deleting an entry only changes the list itself; a test that
 * already saved the old text keeps it untouched.
 */
export function LisCombobox({
  label,
  value,
  onChange,
  options,
  onAddOption,
  onRenameOption,
  onDeleteOption,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  onAddOption: (value: string) => void;
  onRenameOption?: (id: string, value: string) => void;
  onDeleteOption?: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNewItemText('');
        setEditingId(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setNewItemText('');
        setEditingId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Focus input when popover opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  function handleCreate() {
    const trimmed = newItemText.trim();
    if (!trimmed) return;
    const existing = options.find((o) => o.value.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      onChange(existing.value);
    } else {
      onAddOption(trimmed);
      onChange(trimmed);
    }
    setNewItemText('');
    setOpen(false);
  }

  function startEdit(option: ComboboxOption) {
    setEditingId(option.id);
    setEditDraft(option.value);
  }

  function confirmEdit() {
    if (editingId && editDraft.trim() && onRenameOption) {
      onRenameOption(editingId, editDraft.trim());
    }
    setEditingId(null);
  }

  return (
    <div ref={containerRef} className={`relative block ${className ?? ''}`}>
      <span className="pointer-events-none absolute -top-2 left-2.5 z-10 bg-white px-1 text-[11px] font-medium leading-4 text-slate-500">
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-[38px] w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">{placeholder ?? `— Select ${label} —`}</option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.value}>
                {opt.value}
              </option>
            ))}
            {value && !options.some((opt) => opt.value === value) && (
              <option value={value}>{value}</option>
            )}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          title={`Add / Manage ${label}`}
          aria-label={`Add / Manage ${label}`}
          aria-expanded={open}
          className={`inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md border text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-brand-200 ${
            open
              ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
              : 'border-slate-300 bg-white text-slate-600 shadow-sm hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-600'
          }`}
        >
          <Icon name="plus" className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl ring-1 ring-black/5 sm:w-80">
          <div className="mb-2.5 flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Add {label}
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setNewItemText('');
                setEditingId(null);
              }}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
            className="flex items-center gap-1.5"
          >
            <input
              ref={inputRef}
              type="text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder={`New ${label.toLowerCase()}...`}
              className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 text-xs text-slate-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            <button
              type="submit"
              disabled={!newItemText.trim()}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-brand-600 px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              <span>Add</span>
            </button>
          </form>

          {options.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-2.5">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-400">
                <span>Existing items ({options.length})</span>
                <span className="text-[10px] text-slate-400">Click to select</span>
              </div>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto pr-0.5 text-xs">
                {options.map((opt) => (
                  <li
                    key={opt.id}
                    className={`group flex items-center justify-between rounded px-2 py-1 text-left transition-colors ${
                      opt.value === value
                        ? 'bg-brand-50 font-medium text-brand-700'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {editingId === opt.id ? (
                      <div className="flex w-full items-center gap-1">
                        <input
                          autoFocus
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') confirmEdit();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="h-6 min-w-0 flex-1 rounded border border-brand-300 px-1.5 text-xs outline-none focus:ring-1 focus:ring-brand-200"
                        />
                        <button
                          type="button"
                          onClick={confirmEdit}
                          className="grid h-6 w-6 place-items-center rounded text-emerald-600 hover:bg-emerald-50"
                          title="Save"
                        >
                          <Icon name="check" className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100"
                          title="Cancel"
                        >
                          <Icon name="close" className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onChange(opt.value);
                            setOpen(false);
                          }}
                          className="min-w-0 flex-1 truncate text-left"
                          title={`Select "${opt.value}"`}
                        >
                          {opt.value}
                          {opt.value === value && (
                            <span className="ml-1.5 text-[10px] text-brand-600">✓</span>
                          )}
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {onRenameOption && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEdit(opt);
                              }}
                              className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                              title="Rename"
                            >
                              <Icon name="edit" className="h-3 w-3" />
                            </button>
                          )}
                          {onDeleteOption && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (
                                  window.confirm(
                                    `Remove "${opt.value}" from ${label} options? Tests already using it will keep it.`,
                                  )
                                ) {
                                  onDeleteOption(opt.id);
                                }
                              }}
                              className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              title="Delete"
                            >
                              <Icon name="trash" className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A decimal-number field that keeps what is being typed ("12." on the way to
 *  "12.5") instead of snapping it back on every keystroke. */
export function LisNumber({
  label,
  value,
  onChange,
  className,
  readOnly,
  integer = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  className?: string;
  readOnly?: boolean;
  integer?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));

  // Follow the value when something else changes it (Amount recalculating from
  // Rate, loading another test) — but not when the draft already means it.
  useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  const pattern = integer ? /^\d*$/ : /^\d*\.?\d{0,2}$/;

  return (
    <LisField label={label} className={className}>
      <input
        inputMode={integer ? 'numeric' : 'decimal'}
        value={draft}
        readOnly={readOnly}
        onChange={(e) => {
          const text = e.target.value;
          if (!pattern.test(text)) return;
          setDraft(text);
          onChange(text === '' || text === '.' ? 0 : Number(text));
        }}
        className={controlClass}
      />
    </LisField>
  );
}

export function LisSelect({
  label,
  value,
  onChange,
  options,
  className,
  onAddOption,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  onAddOption?: (value: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNewItemText('');
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setNewItemText('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  async function handleAdd() {
    const trimmed = newItemText.trim();
    if (!trimmed || !onAddOption || submitting) return;
    setSubmitting(true);
    try {
      await onAddOption(trimmed);
      setNewItemText('');
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (!onAddOption) {
    return (
      <LisField label={label} className={className}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={controlClass}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </LisField>
    );
  }

  return (
    <div ref={containerRef} className={`relative block ${className ?? ''}`}>
      <span className="pointer-events-none absolute -top-2 left-2.5 z-10 bg-white px-1 text-[11px] font-medium leading-4 text-slate-500">
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-[38px] w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          title={`Add ${label}`}
          aria-label={`Add ${label}`}
          aria-expanded={open}
          className={`inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md border text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-brand-200 ${
            open
              ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
              : 'border-slate-300 bg-white text-slate-600 shadow-sm hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-600'
          }`}
        >
          <Icon name="plus" className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl ring-1 ring-black/5 sm:w-80">
          <div className="mb-2.5 flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Add {label}
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setNewItemText('');
              }}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleAdd();
            }}
            className="flex items-center gap-1.5"
          >
            <input
              ref={inputRef}
              type="text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder={`New ${label.toLowerCase()}...`}
              disabled={submitting}
              className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 text-xs text-slate-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            <button
              type="submit"
              disabled={!newItemText.trim() || submitting}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-brand-600 px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              <span>{submitting ? 'Adding...' : 'Add'}</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function LisTextarea({
  label,
  value,
  onChange,
  rows = 5,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <LisField label={label} className={className}>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${controlClass} resize-y`}
      />
    </LisField>
  );
}

export function LisCheck({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Greys the row out and blocks toggling — for a switch that only means
   *  something alongside another one (e.g. "Most Common Test" needs "Show in
   *  the app" on too) rather than being removed from the form entirely. */
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${
        disabled ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-700'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {label}
    </label>
  );
}
