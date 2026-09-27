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
  .superRefine((doc, ctx) => {
    doc.events.forEach((event, index) => {
      if (event.type === 'input' && event.redacted && event.value !== null) {
        ctx.addIssue({ code: 'custom', path: ['events', index, 'value'], message: 'Redacted inputs must not carry a value' });
      }
    });
  });

/** Response of `POST /__flowtape/flows`. */
export const SavedFlowSchema = z.object({
  slug: z.string(),
  flowFile: z.string(),
  promptFile: z.string(),
  prompt: z.string(),
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
