import { z } from 'zod';
import { appendEvent, rebase, type Capture } from './recorder';
import { HistoryAppendResultSchema } from './schemas';
import type { FlowMeta, HistoryBatch, HistoryEvent } from './types';

/** localStorage key for the overlay toggle: `1` on, `0` off. */
export const HISTORY_PREF_KEY = 'flowtape:history';
/** sessionStorage key for the current session, so reloads in one tab append to the same file. */
export const HISTORY_SESSION_KEY = 'flowtape:history-session';

const MAX_BATCH = 200;

export interface SessionHistorySnapshot {
  /** The user's toggle. */
  enabled: boolean;
  /** Enabled and mounted: events are being captured. */
  active: boolean;
  sessionId?: string;
  /** Events captured this session in this page. */
  events: number;
  /** Relative path of the JSONL file, known after the first write. */
  file?: string;
  error?: string;
}

export interface SessionHistory {
  /** Capture runs while at least one subscriber (the overlay) is mounted and history is enabled. */
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionHistorySnapshot;
  /** Turn capture on or off and remember the choice in localStorage. */
  setEnabled(enabled: boolean): void;
  /** Send buffered events now. */
  flush(): Promise<void>;
}

export interface SessionHistoryOptions {
  capture: Capture;
  /** Base URL of the flowtape middleware. Default `/__flowtape`. */
  endpoint?: string;
  /** Used when the user has not toggled history yet. Default true. */
  defaultEnabled?: boolean;
  /** Delay before a batch is sent. Default 1000ms. */
  flushMs?: number;
}

const StoredSessionSchema = z.object({ id: z.string(), startedAt: z.iso.datetime(), startUrl: z.string().optional() });
type StoredSession = z.infer<typeof StoredSessionSchema>;

const ErrorSchema = z.object({ error: z.string() });

function randomSessionId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function readPref(fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(HISTORY_PREF_KEY);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

function writePref(enabled: boolean): void {
  try {
    localStorage.setItem(HISTORY_PREF_KEY, enabled ? '1' : '0');
  } catch {
    // Storage blocked: the toggle still works for this page.
  }
}

/** Reuse this tab's session, or start one. */
function loadSession(capture: Capture): StoredSession {
  try {
    const raw = sessionStorage.getItem(HISTORY_SESSION_KEY);
    const parsed = raw ? StoredSessionSchema.safeParse(JSON.parse(raw)) : null;
    if (parsed?.success) return parsed.data;
  } catch {
    // Fall through to a fresh session.
  }
  const session = { id: randomSessionId(), startedAt: new Date(capture.now()).toISOString(), startUrl: capture.page().url };
  try {
    sessionStorage.setItem(HISTORY_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage blocked: the session lasts for this page only.
  }
  return session;
}

function pageMeta(): FlowMeta {
  return { userAgent: navigator.userAgent, viewport: { width: window.innerWidth, height: window.innerHeight } };
}

/**
 * Always-on DEV telemetry. Appends redacted events to `.flowtape/history/<date>-<sessionId>.jsonl`
 * through `POST /__flowtape/history`. No network traffic, request bodies, cookies or headers are captured.
 */
export function createSessionHistory(options: SessionHistoryOptions): SessionHistory {
  const { capture } = options;
  const endpoint = options.endpoint ?? '/__flowtape';
  const flushMs = options.flushMs ?? 1000;
  const listeners = new Set<() => void>();
  let snapshot: SessionHistorySnapshot = { enabled: readPref(options.defaultEnabled ?? true), active: false, events: 0 };
  let session: StoredSession | null = null;
  let queue: HistoryEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
  let lastUrl = '';
  let unsubscribe: (() => void) | null = null;

  const set = (next: Partial<SessionHistorySnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };

  const send = async (keepalive: boolean) => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!session || queue.length === 0 || (sending && !keepalive)) return;
    const batch: HistoryBatch = { sessionId: session.id, startedAt: session.startedAt, startUrl: session.startUrl, meta: pageMeta(), events: queue };
    queue = [];
    sending = true;
    try {
      const res = await fetch(`${endpoint}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        keepalive,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = ErrorSchema.safeParse(json);
        throw new Error(error.success ? error.data.error : `History write failed (${res.status})`);
      }
      set({ file: HistoryAppendResultSchema.parse(json).file, error: undefined });
    } catch (err) {
      // Dropped, not retried: history is best-effort and must not grow without bound.
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      sending = false;
      if (queue.length > 0) schedule();
    }
  };

  const schedule = () => {
    if (queue.length >= MAX_BATCH) void send(false);
    else timer ??= setTimeout(() => void send(false), flushMs);
  };

  const push = (event: HistoryEvent) => {
    if (!session) return;
    if (event.type === 'navigate') {
      if (event.url === lastUrl) return;
      lastUrl = event.url;
    }
    const before = queue.length;
    queue = appendEvent(queue, rebase(event, Date.parse(session.startedAt)));
    set({ events: snapshot.events + (queue.length > before ? 1 : 0) });
    schedule();
  };

  const onPageHide = () => {
    capture.flush();
    void send(true);
  };

  const start = () => {
    session = loadSession(capture);
    set({ active: true, sessionId: session.id });
    unsubscribe = capture.subscribe(push);
    window.addEventListener('pagehide', onPageHide);
    push(capture.page());
  };

  const stop = () => {
    window.removeEventListener('pagehide', onPageHide);
    capture.flush();
    unsubscribe?.();
    unsubscribe = null;
    void send(false);
    set({ active: false });
  };

  const sync = () => {
    const want = snapshot.enabled && listeners.size > 0;
    if (want && !unsubscribe) start();
    else if (!want && unsubscribe) stop();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      sync();
      return () => {
        listeners.delete(listener);
        // Deferred so a StrictMode unmount/remount does not end and restart the session.
        queueMicrotask(sync);
      };
    },
    getSnapshot: () => snapshot,
    setEnabled(enabled) {
      writePref(enabled);
      set({ enabled });
      sync();
    },
    flush() {
      capture.flush();
      return send(false);
    },
  };
}
