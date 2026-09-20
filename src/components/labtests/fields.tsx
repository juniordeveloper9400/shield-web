import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';

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
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      {label}
    </label>
  );
}
