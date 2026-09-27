import { useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { z } from 'zod';
import { createSessionHistory, type SessionHistory, type SessionHistorySnapshot } from '../history';
import { createCapture, createFlowDocument, createRecorder, type Capture, type Recorder } from '../recorder';
import { SavedFlowSchema } from '../schemas';
import type { FlowEvent, SavedFlow } from '../types';

export const DEFAULT_ENDPOINT = '/__flowtape';

export interface FlowtapeOverlayProps {
  /** Force on or off. Default: on outside production builds. */
  enabled?: boolean;
  /** Base URL of the flowtape middleware. Default `/__flowtape`. */
  endpoint?: string;
  /** Bring your own recorder. Default: one shared recorder per page, so recordings survive remounts and HMR. */
  recorder?: Recorder;
  /** Bring your own session history. Default: one per page, sharing page listeners with the default recorder. */
  sessionHistory?: SessionHistory;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; saved: SavedFlow; copied: boolean }
  | { kind: 'error'; message: string };

const ErrorSchema = z.object({ error: z.string() });

// One capture per page: named recording and session history share its listeners, so each DOM event is handled once.
let sharedCapture: Capture | undefined;
let sharedRecorder: Recorder | undefined;
let sharedHistory: SessionHistory | undefined;

function defaultCapture(): Capture {
  sharedCapture ??= createCapture();
  return sharedCapture;
}

function defaultRecorder(): Recorder {
  sharedRecorder ??= createRecorder({ capture: defaultCapture() });
  return sharedRecorder;
}

function defaultHistory(endpoint: string): SessionHistory {
  sharedHistory ??= createSessionHistory({ capture: defaultCapture(), endpoint });
  return sharedHistory;
}

function isProduction(): boolean {
  try {
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

const noopSubscribe = () => () => {};
const offHistory: SessionHistorySnapshot = { enabled: false, active: false, events: 0 };
const getOffHistory = () => offHistory;

/** False during SSR and hydration, true once running in the browser. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function summarise(event: FlowEvent): string {
  switch (event.type) {
    case 'navigate':
      try {
        return `navigate ${new URL(event.url).pathname}`;
      } catch {
        return `navigate ${event.url}`;
      }
    case 'click':
      return `click ${event.name ? `"${event.name}"` : event.selector}`;
    case 'input':
      return `input ${event.name ?? event.selector} ${event.redacted ? '(redacted)' : `= "${event.value ?? ''}"`}`;
    case 'submit':
      return `submit ${event.selector ?? 'form'}`;
  }
}

async function postFlow(endpoint: string, body: string): Promise<SavedFlow> {
  const res = await fetch(`${endpoint}/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const json = await res.json().catch(() => ({}));
  if (res.ok) return SavedFlowSchema.parse(json);
  const error = ErrorSchema.safeParse(json);
  throw new Error(error.success ? error.data.error : `Save failed (${res.status})`);
}

/** Floating panel: named flow recording (record / stop / export) and the session history toggle. Portals into `document.body`. */
export function FlowtapeOverlay({ enabled, endpoint = DEFAULT_ENDPOINT, recorder = defaultRecorder(), sessionHistory = defaultHistory(endpoint) }: FlowtapeOverlayProps) {
  const isClient = useIsClient();
  const on = (enabled ?? !isProduction()) && isClient;
  const snapshot = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, recorder.getSnapshot);
  // Subscribing is what starts session capture, so only subscribe while the overlay is shown.
  const history = useSyncExternalStore(
    on ? sessionHistory.subscribe : noopSubscribe,
    on ? sessionHistory.getSnapshot : getOffHistory,
    getOffHistory,
  );
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  if (!on) return null;

  const { recording, events } = snapshot;
  const last = events[events.length - 1];
  const canExport = !recording && events.length > 0 && status.kind !== 'saving';

  const onRecord = () => {
    setStatus({ kind: 'idle' });
    recorder.start();
  };

  const onExport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    const doc = createFlowDocument({
      name: typeof name === 'string' ? name : '',
      events,
      startUrl: snapshot.startUrl,
      meta: { userAgent: navigator.userAgent, viewport: { width: window.innerWidth, height: window.innerHeight } },
    });
    setStatus({ kind: 'saving' });
    try {
      setStatus({ kind: 'saved', saved: await postFlow(endpoint, JSON.stringify(doc)), copied: false });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const onCopy = async (saved: SavedFlow) => {
    await navigator.clipboard.writeText(saved.prompt);
    setStatus({ kind: 'saved', saved, copied: true });
  };

  return createPortal(
    <div data-flowtape-ui="" style={styles.panel} role="region" aria-label="flowtape recorder">
      <div style={styles.header}>
        <span style={{ ...styles.dot, background: recording ? '#ef4444' : '#6b7280' }} aria-hidden />
        <strong>Record flow</strong>
        <span style={styles.muted} data-testid="flowtape-count">
          {recording ? 'Recording' : 'Idle'} · {events.length} events
        </span>
      </div>
      <div style={styles.row}>
        {recording ? (
          <button type="button" style={{ ...styles.button, ...styles.danger }} onClick={() => recorder.stop()}>
            Stop
          </button>
        ) : (
          <button type="button" style={{ ...styles.button, ...styles.primary }} onClick={onRecord}>
            Record
          </button>
        )}
        <button type="button" style={styles.button} onClick={() => recorder.clear()} disabled={recording || events.length === 0}>
          Clear
        </button>
      </div>
      {last ? (
        <div style={styles.preview} title={summarise(last)}>
          Last: {summarise(last)}
        </div>
      ) : null}
      <form style={styles.row} onSubmit={onExport}>
        <input name="name" placeholder="Flow name" aria-label="Flow name" style={styles.input} disabled={recording} />
        <button type="submit" style={styles.button} disabled={!canExport}>
          {status.kind === 'saving' ? 'Saving…' : 'Export'}
        </button>
      </form>
      {status.kind === 'saved' ? (
        <div style={styles.status} data-testid="flowtape-saved">
          Saved <code>{status.saved.promptFile}</code>
          <button type="button" style={styles.link} onClick={() => onCopy(status.saved)}>
            {status.copied ? 'Copied' : 'Copy prompt'}
          </button>
        </div>
      ) : null}
      {status.kind === 'error' ? (
        <div style={{ ...styles.status, color: '#fca5a5' }} role="alert">
          {status.message}
        </div>
      ) : null}
      <div style={styles.section} data-testid="flowtape-history">
        <div style={styles.header}>
          <span style={{ ...styles.dot, background: history.active ? '#22c55e' : '#6b7280' }} aria-hidden />
          <strong>Session history</strong>
          <button
            type="button"
            role="switch"
            aria-checked={history.enabled}
            aria-label="Session history"
            style={{ ...styles.button, ...styles.toggle, ...(history.enabled ? styles.primary : {}) }}
            onClick={() => sessionHistory.setEnabled(!history.enabled)}
          >
            {history.enabled ? 'On' : 'Off'}
          </button>
        </div>
        {history.active ? (
          <div style={styles.detail}>
            <span data-testid="flowtape-history-session">{history.sessionId}</span> · {history.events} events
            <br />
            <code style={styles.path}>{history.file ?? '.flowtape/history/'}</code>
          </div>
        ) : (
          <div style={styles.detail}>Off. Named recording still works.</div>
        )}
        {history.error ? (
          <div style={{ ...styles.status, color: '#fca5a5' }} role="alert">
            {history.error}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

const styles = {
  panel: {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 2147483647,
    width: 280,
    padding: 12,
    borderRadius: 10,
    background: '#111827',
    color: '#f9fafb',
    font: '12px/1.4 system-ui, sans-serif',
    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
    display: 'grid',
    gap: 8,
  },
  header: { display: 'flex', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: '50%' },
  muted: { marginLeft: 'auto', color: '#9ca3af' },
  row: { display: 'flex', gap: 6 },
  button: {
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid #374151',
    background: '#1f2937',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  },
  primary: { background: '#2563eb', borderColor: '#2563eb' },
  danger: { background: '#dc2626', borderColor: '#dc2626' },
  input: {
    flex: 1,
    minWidth: 0,
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid #374151',
    background: '#030712',
    color: 'inherit',
    font: 'inherit',
  },
  preview: { color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  status: { color: '#86efac', wordBreak: 'break-all' },
  // Tone shift, not a divider, separates session history from named recording.
  section: { display: 'grid', gap: 4, margin: '0 -12px -12px', padding: '8px 12px 12px', borderRadius: '0 0 10px 10px', background: '#0b1220' },
  toggle: { marginLeft: 'auto', padding: '1px 8px' },
  detail: { color: '#9ca3af' },
  path: { color: '#d1d5db', wordBreak: 'break-all' },
  link: { marginLeft: 6, padding: 0, border: 0, background: 'none', color: '#93c5fd', font: 'inherit', cursor: 'pointer' },
} satisfies Record<string, CSSProperties>;
