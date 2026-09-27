import { useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { z } from 'zod';
import { createFlowDocument, createRecorder, type Recorder } from '../recorder';
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
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; saved: SavedFlow; copied: boolean }
  | { kind: 'error'; message: string };

const ErrorSchema = z.object({ error: z.string() });

let sharedRecorder: Recorder | undefined;
function defaultRecorder(): Recorder {
  sharedRecorder ??= createRecorder();
  return sharedRecorder;
}

function isProduction(): boolean {
  try {
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

const noopSubscribe = () => () => {};

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

/** Floating record / stop / export panel. Portals into `document.body`. */
export function FlowtapeOverlay({ enabled, endpoint = DEFAULT_ENDPOINT, recorder = defaultRecorder() }: FlowtapeOverlayProps) {
  const isClient = useIsClient();
  const snapshot = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, recorder.getSnapshot);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  if (!(enabled ?? !isProduction()) || !isClient) return null;

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
        <strong>flowtape</strong>
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
  link: { marginLeft: 6, padding: 0, border: 0, background: 'none', color: '#93c5fd', font: 'inherit', cursor: 'pointer' },
} satisfies Record<string, CSSProperties>;
