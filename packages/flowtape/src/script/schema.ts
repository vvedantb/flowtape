import { z } from 'zod';

/** Replay script format. Separate from FLOW_VERSION, which versions the overlay FlowDocument. */
export const SCRIPT_VERSION = 1;

const Viewport = z.object({ width: z.number().positive(), height: z.number().positive() });

export const ReplaySelectorSchema = z.object({
  strategy: z.enum(['test-id', 'role', 'label', 'placeholder', 'text', 'css']),
  value: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
});

export const ReplayExpectedSchema = z.object({
  kind: z.enum(['url', 'element', 'none']),
  url: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
});

export const ReplayStepSchema = z
  .object({
    type: z.enum(['click', 'type', 'navigate', 'select', 'scroll', 'key']),
    /** Milliseconds since the recording started. */
    ts: z.number().nonnegative(),
    url: z.string(),
    viewport: Viewport.optional(),
    /** Tried in order on replay. */
    selectors: z.array(ReplaySelectorSchema),
    /** Typed or selected value. `null` when redacted. */
    value: z.string().nullable().optional(),
    redacted: z.boolean().optional(),
    /** Length of a redacted value. */
    length: z.number().int().nonnegative().optional(),
    inputType: z.string().optional(),
    /** Name of the field, used to pick the `FLOWTAPE_*` env var for redacted values. */
    name: z.string().optional(),
    key: z.string().optional(),
    scroll: z.object({ x: z.number(), y: z.number() }).optional(),
    expected: ReplayExpectedSchema,
    /** Raw base64 PNGs, no `data:` prefix. */
    screenshots: z.object({ page: z.string().optional(), target: z.string().optional() }).optional(),
  })
  .superRefine((step, ctx) => {
    if (step.redacted && step.value !== null && step.value !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Redacted steps must not carry a value' });
    }
  });

export const ReplayScriptSchema = z.object({
  version: z.literal(SCRIPT_VERSION),
  kind: z.literal('flowtape-replay-script'),
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  startUrl: z.string(),
  viewport: Viewport,
  steps: z.array(ReplayStepSchema),
});

export type ReplaySelector = z.infer<typeof ReplaySelectorSchema>;
export type ReplayExpected = z.infer<typeof ReplayExpectedSchema>;
export type ReplayStep = z.infer<typeof ReplayStepSchema>;
export type ReplayScript = z.infer<typeof ReplayScriptSchema>;
