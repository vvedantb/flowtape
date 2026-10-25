import { IconFile } from "@tabler/icons-react";
import { Button, landingPanelClass } from "@vvedantb/ui";
import { useState, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";

/** Browser-window frame shared by the product mocks. */
export function MockWindow({ url, tag, label, children }: { url: string; tag: string; label: string; children: ReactNode }) {
  return (
    <div className={landingPanelClass} role="group" aria-label={label}>
      <div className="flex h-10 items-center gap-3 border-b border-separator px-4 font-mono text-xs text-muted">
        <span className="flex gap-1.5" aria-hidden>
          <i className="size-2.5 rounded-full bg-foreground/15" />
          <i className="size-2.5 rounded-full bg-foreground/15" />
          <i className="size-2.5 rounded-full bg-foreground/15" />
        </span>
        <span className="min-w-0 flex-1 truncate">{url}</span>
        <span className="rounded-full border border-separator px-2 py-0.5 text-[10px]">{tag}</span>
      </div>
      <div className="flex min-h-64 flex-col gap-4 p-4 sm:p-5">{children}</div>
    </div>
  );
}

/** Pressed-state button group. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit rounded-lg border border-separator p-0.5">
      {options.map((o) => (
        <Button
          key={o.id}
          type="button"
          size="sm"
          variant={value === o.id ? "default" : "ghost"}
          aria-pressed={value === o.id}
          className="h-7 px-3 text-xs"
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

const mono = "font-mono text-xs";

const RECORD_EVENTS = [
  "navigate  /",
  "type      Email  ada@example.test",
  "type      Password  (redacted, 21 chars)",
  "click     Sign in",
  "navigate  /notes",
  "type      New note  Water the plants",
  "click     Add",
] as const;

export function RecordMock() {
  const [count, setCount] = useState(3);
  const done = count >= RECORD_EVENTS.length;
  return (
    <MockWindow url="localhost:5173" tag="flowtape" label="Mock of the flowtape overlay while recording">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="inline-flex items-center gap-2 text-foreground">
          <span className="size-2 rounded-full bg-foreground" aria-hidden />
          Recording
        </span>
        <span>{count} events</span>
      </div>
      <ol className={`${mono} flex flex-col gap-1.5 text-muted`}>
        {RECORD_EVENTS.slice(0, count).map((e, i) => (
          <li key={e} className={i === count - 1 ? "text-foreground" : undefined}>
            <span className="mr-2 opacity-50">{String(i + 1).padStart(2, "0")}</span>
            {e}
          </li>
        ))}
      </ol>
      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="truncate text-xs text-muted">Last: {RECORD_EVENTS[count - 1]?.split(/\s{2,}/)[0]}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setCount(done ? 1 : count + 1)}
        >
          {done ? "Start over" : "Next event"}
        </Button>
      </div>
    </MockWindow>
  );
}

const CHECKS = [
  { id: "text", label: "Text" },
  { id: "count", label: "Count" },
  { id: "gone", label: "Gone" },
] as const;
type CheckId = (typeof CHECKS)[number]["id"];

const NOTES = ["Water the plants", "Book the dentist", "Reply to Sam"];

export function AssertMock() {
  const [check, setCheck] = useState<CheckId>("text");
  const [picked, setPicked] = useState(0);
  const result: Record<CheckId, string> = {
    text: `note-item ${picked + 1} is visible and contains "${NOTES[picked]}"`,
    count: `3 elements match note-item`,
    gone: `note-item "${NOTES[picked]}" is hidden after the next action`,
  };
  return (
    <MockWindow url="localhost:5173/notes" tag="flowtape" label="Mock of the Assert picker">
      <Segmented options={CHECKS} value={check} onChange={setCheck} label="Check type" />
      <ul className="flex flex-col gap-1.5 text-sm">
        {NOTES.map((n, i) => (
          <li key={n}>
            <button
              type="button"
              onClick={() => setPicked(i)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                i === picked ? "border-foreground/50 bg-surface-secondary" : "border-separator hover:bg-surface-secondary"
              }`}
            >
              <span>{n}</span>
              <small className={`${mono} text-muted`}>note-item</small>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-auto text-xs" aria-live="polite">
        <b className="mr-2 font-medium">Check:</b>
        <span className="text-muted">{result[check]}</span>
      </p>
    </MockWindow>
  );
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function ExportMock() {
  const [name, setName] = useState("Login and add note");
  const [saved, setSaved] = useState(false);
  const slug = slugify(name) || "flow";
  return (
    <MockWindow url="localhost:5173" tag="flowtape" label="Mock of the export step">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full border border-muted" aria-hidden />
          Stopped
        </span>
        <span>7 events</span>
      </div>
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Name
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          className="h-9 rounded-lg border border-separator bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        />
        <span className={mono}>slug: {slug}</span>
      </label>
      {saved ? (
        <ul className={`${mono} flex flex-col gap-1.5`}>
          {[`flows/${slug}.json`, `prompts/${slug}.md`, `e2e/${slug}.e2e.ts`].map((p) => (
            <li key={p} className="flex items-center gap-2 break-all">
              <IconFile size={14} aria-hidden className="shrink-0" />
              .flowtape/{p}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex items-center justify-end gap-2">
        {saved ? (
          <CopyButton
            text={`Follow @.flowtape/prompts/${slug}.md against the running app`}
            label="Copy prompt"
            size="sm"
          >
            Copy prompt
          </CopyButton>
        ) : null}
        <Button type="button" size="sm" onClick={() => setSaved(true)}>
          Export
        </Button>
      </div>
    </MockWindow>
  );
}

const PROMPT_EXCERPT = `# Flow: Login and add note

## Goal
Replay the recorded journey in a real browser
and confirm each step works as recorded.

## Preconditions
- Redacted fields read their values from
  environment variables: \`FLOWTAPE_PASSWORD\`.

## Steps
1. Open \`/\`.
2. Type \`ada@example.test\` into the field "Email".
3. Fill the password field with \`$FLOWTAPE_PASSWORD\`.

## Assertions
## Fuzz hints
## Out of bounds
## Report back`;

export function PromptMock() {
  return (
    <MockWindow url=".flowtape/prompts/login-and-add-note.md" tag="Excerpt" label="Excerpt of a generated prompt">
      <pre className={`${mono} overflow-x-auto leading-relaxed text-muted`}>
        <code>{PROMPT_EXCERPT}</code>
      </pre>
    </MockWindow>
  );
}

export function HistoryMock() {
  const [on, setOn] = useState(false);
  return (
    <MockWindow url=".flowtape/history/<date>-<sessionId>.jsonl" tag="Illustration" label="Illustration of the session history switch">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p id="hist-label" className="text-sm font-medium">
            Session history
          </p>
          <p className="text-xs text-muted">{on ? "On" : "Off"}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="hist-label"
          onClick={() => setOn(!on)}
          className={`relative h-6 w-11 shrink-0 rounded-full border border-separator transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
            on ? "bg-foreground" : "bg-surface-secondary"
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 size-4.5 rounded-full transition-transform ${
              on ? "translate-x-5 bg-background" : "bg-foreground/50"
            }`}
          />
        </button>
      </div>
      <pre className={`${mono} overflow-x-auto leading-relaxed text-muted`} aria-live="off">
        <code>
          {on
            ? `{"type":"session","id":"a1b2c3","startUrl":"/"}
{"ts":0,"type":"navigate","url":"/"}
{"ts":1840,"type":"click","target":"Sign in"}
{"ts":2210,"type":"navigate","url":"/notes"}`
            : "Nothing is logged while this is off."}
        </code>
      </pre>
    </MockWindow>
  );
}

export function RedactionMock() {
  const [view, setView] = useState<"typed" | "stored">("stored");
  const rows = [
    ["Password", "correct-horse-battery", "redacted: true, value: null, length: 21"],
    ["Email", "jane.doe@company.co.uk", "[REDACTED]"],
    ["API key", "api_key_looks_like_this_example_000", "[REDACTED]"],
    ["Postcode", "SW1A 1AA", "[REDACTED]"],
    ["Test email", "ada@example.test", "ada@example.test"],
  ] as const;
  return (
    <MockWindow url="What you typed vs what is stored" tag="Illustration" label="Illustration of typed and stored values">
      <Segmented
        options={[
          { id: "typed", label: "Typed" },
          { id: "stored", label: "Stored" },
        ]}
        value={view}
        onChange={setView}
        label="View"
      />
      <dl className="flex flex-col divide-y divide-separator text-sm">
        {rows.map(([k, raw, stored]) => (
          <div key={k} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between sm:gap-4">
            <dt className="text-muted">{k}</dt>
            <dd className={`${mono} break-all sm:text-right`}>{view === "typed" ? raw : stored}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">Reserved example domains such as *.test are kept, so test accounts replay.</p>
    </MockWindow>
  );
}
