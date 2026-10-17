import { useEffect, useId, useState } from 'react';
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
  onRenameOption: (id: string, value: string) => void;
  onDeleteOption: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const q = value.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.value.toLowerCase().includes(q)) : options;
  const exactMatch = options.some((o) => o.value.toLowerCase() === q);

  function close() {
    setOpen(false);
    setEditingId(null);
  }

  function startEdit(option: ComboboxOption) {
    setEditingId(option.id);
    setEditDraft(option.value);
  }

  function confirmEdit() {
    if (editingId && editDraft.trim()) onRenameOption(editingId, editDraft.trim());
    setEditingId(null);
  }

  return (
    <LisField label={label} className={`relative ${className ?? ''}`}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={close}
        placeholder={placeholder}
        className={controlClass}
      />
      {open && (
        <ul
          // Keeps the input focused while a row's own buttons are used —
          // otherwise the blur above would close this before the click on
          // Select/Edit/Delete ever registers.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2 text-slate-400">No matches — keep typing to use it anyway.</li>
          )}
          {matches.map((option) =>
            editingId === option.id ? (
              <li key={option.id} className="flex items-center gap-1 px-2 py-1">
                <input
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmEdit();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-brand-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-brand-100"
                />
                <button
                  type="button"
                  onClick={confirmEdit}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-emerald-600 hover:bg-emerald-50"
                  aria-label="Save"
                >
                  <Icon name="check" className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100"
                  aria-label="Cancel"
                >
                  <Icon name="close" className="h-3.5 w-3.5" />
                </button>
              </li>
            ) : (
              <li key={option.id} className="group flex items-center gap-1 px-2 py-0.5 hover:bg-slate-50">
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                  className="min-w-0 flex-1 truncate px-1 py-1.5 text-left text-slate-700"
                >
                  {option.value}
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(option)}
                  className="hidden h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 group-hover:grid"
                  aria-label={`Rename "${option.value}"`}
                >
                  <Icon name="edit" className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Remove "${option.value}" from this list? Tests that already used it keep it.`)) {
                      onDeleteOption(option.id);
                    }
                  }}
                  className="hidden h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 group-hover:grid"
                  aria-label={`Delete "${option.value}"`}
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </li>
            ),
          )}
          {q && !exactMatch && (
            <li className="border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  onAddOption(value.trim());
                  close();
                }}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-medium text-brand-600 hover:bg-brand-50"
              >
                <Icon name="plus" className="h-3.5 w-3.5" /> Add “{value.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}
    </LisField>
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
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
