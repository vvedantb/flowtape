import { z } from 'zod';

/** Current FlowDocument format. Bump when the shape changes incompatibly. */
export const FLOW_VERSION = 1;

/** Lowercase kebab-case. Doubles as the file name, so no dots or slashes. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `ts` is milliseconds since the recording started. */
const ts = z.number().nonnegative();

export const NavigateEventSchema = z.object({
  type: z.literal('navigate'),
  ts,
  url: z.string(),
  title: z.string().optional(),
});

export const ClickEventSchema = z.object({
  type: z.literal('click'),
  ts,
  selector: z.string(),
  text: z.string().optional(),
  role: z.string().optional(),
  /** Accessible name: aria-label, label text or visible text. */
  name: z.string().optional(),
  href: z.string().optional(),
});

export const InputEventSchema = z.object({
  type: z.literal('input'),
  ts,
  selector: z.string(),
  /** Final typed value. Always `null` when `redacted` is true. */
  value: z.string().nullable(),
  /** The element's `type` (text, email, password, checkbox, ...) or tag (textarea, select). */
  inputType: z.string().optional(),
  name: z.string().optional(),
  redacted: z.boolean(),
  /** Length of a redacted value, so an agent can type something of similar size. */
  length: z.number().int().nonnegative().optional(),
});

export const SubmitEventSchema = z.object({
  type: z.literal('submit'),
  ts,
  selector: z.string().optional(),
  action: z.string().optional(),
  method: z.string().optional(),
});

export const FlowEventSchema = z.discriminatedUnion('type', [
  NavigateEventSchema,
  ClickEventSchema,
  InputEventSchema,
  SubmitEventSchema,
]);

/** Uncaught error or unhandled rejection. Session history only; named flows never contain these. */
export const PageErrorEventSchema = z.object({
  type: z.literal('error'),
  ts,
  kind: z.enum(['error', 'unhandledrejection']),
  message: z.string(),
  source: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
});

/** Everything the page capture emits: flow events plus page errors. */
export const HistoryEventSchema = z.discriminatedUnion('type', [
  NavigateEventSchema,
  ClickEventSchema,
  InputEventSchema,
  SubmitEventSchema,
  PageErrorEventSchema,
]);

/** A redacted input must never carry its value. */
function refineRedactedInputs(events: Array<{ type: string; redacted?: boolean; value?: string | null }>, ctx: z.RefinementCtx) {
  events.forEach((event, index) => {
    if (event.type === 'input' && event.redacted && event.value !== null) {
      ctx.addIssue({ code: 'custom', path: ['events', index, 'value'], message: 'Redacted inputs must not carry a value' });
    }
  });
}

export const FlowMetaSchema = z.object({
  userAgent: z.string().optional(),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
});

export const FlowDocumentSchema = z
  .object({
    version: z.literal(FLOW_VERSION),
    id: z.string().min(1),
    slug: z.string().regex(SLUG_PATTERN).max(64),
    name: z.string().min(1).max(200),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    startUrl: z.string().optional(),
    events: z.array(FlowEventSchema),
    meta: FlowMetaSchema.optional(),
  })
  .superRefine((doc, ctx) => refineRedactedInputs(doc.events, ctx));

/** Response of `POST /__flowtape/flows`. */
export const SavedFlowSchema = z.object({
  slug: z.string(),
  flowFile: z.string(),
  promptFile: z.string(),
  prompt: z.string(),
});

/** Short random id for one browser session. Doubles as part of the file name. */
export const SESSION_ID_PATTERN = /^[a-z0-9]{6,32}$/;

/** Body of `POST /__flowtape/history`. `ts` on each event is milliseconds since `startedAt`. */
export const HistoryBatchSchema = z
  .object({
    sessionId: z.string().regex(SESSION_ID_PATTERN),
    startedAt: z.iso.datetime(),
    startUrl: z.string().optional(),
    meta: FlowMetaSchema.optional(),
    events: z.array(HistoryEventSchema).max(1000),
  })
  .superRefine((batch, ctx) => refineRedactedInputs(batch.events, ctx));

/** First line of every `.flowtape/history/*.jsonl` file. Every later line is one HistoryEvent. */
export const HistorySessionLineSchema = z.object({
  type: z.literal('session'),
  version: z.literal(FLOW_VERSION),
  sessionId: z.string().regex(SESSION_ID_PATTERN),
  startedAt: z.iso.datetime(),
  startUrl: z.string().optional(),
  meta: FlowMetaSchema.optional(),
});

/** Response of `POST /__flowtape/history`. */
export const HistoryAppendResultSchema = z.object({
  file: z.string(),
  appended: z.number().int().nonnegative(),
});

/** Turn a human flow name into a file-safe slug. Falls back to `flow`. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug || 'flow';
}
