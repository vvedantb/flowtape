import { Button } from "@vvedantb/ui";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type TabItem = { id: string; label: string; icon?: ReactNode; content: ReactNode };

/** Accessible tab set with arrow-key navigation. */
export function Tabs({ items, label }: { items: readonly TabItem[]; label: string }) {
  const [active, setActive] = useState(items[0]!.id);
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent) {
    const i = items.findIndex((t) => t.id === active);
    const next =
      e.key === "ArrowRight" ? (i + 1) % items.length : e.key === "ArrowLeft" ? (i - 1 + items.length) % items.length : -1;
    if (next < 0) return;
    e.preventDefault();
    const id = items[next]!.id;
    setActive(id);
    refs.current[id]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="mb-6 flex max-w-full gap-1 overflow-x-auto pb-1">
        {items.map((t) => (
          <Button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-t-${t.id}`}
            aria-controls={`${base}-p-${t.id}`}
            aria-selected={active === t.id}
            tabIndex={active === t.id ? 0 : -1}
            size="sm"
            variant={active === t.id ? "default" : "ghost"}
            onClick={() => setActive(t.id)}
          >
            {t.icon}
            {t.label}
          </Button>
        ))}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-p-${t.id}`}
          aria-labelledby={`${base}-t-${t.id}`}
          hidden={active !== t.id}
        >
          {active === t.id ? t.content : null}
        </div>
      ))}
    </div>
  );
}
