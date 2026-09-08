export interface TabItem {
  key: string;
  label: string;
  /** Shown as a small pill after the label when given, hidden at 0. */
  count?: number;
}

/**
 * The tab strip a detail page's sections sit under — one screen answering
 * "who is this", not a scroll through every card stacked on top of the next.
 */
export function Tabs({
  items,
  active,
  onChange,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="border-b border-slate-200">
      <nav className="-mb-px flex flex-wrap gap-6" aria-label="Tabs">
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              aria-current={isActive ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-0.5 pb-3 text-sm font-medium transition ${
                isActive
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {item.label}
              {item.count !== undefined && item.count > 0 && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    isActive
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
