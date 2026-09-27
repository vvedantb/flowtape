import type { z } from 'zod';
import type {
  ClickEventSchema,
  FlowDocumentSchema,
  FlowEventSchema,
  FlowMetaSchema,
  HistoryAppendResultSchema,
  HistoryBatchSchema,
  HistoryEventSchema,
  HistorySessionLineSchema,
  InputEventSchema,
  NavigateEventSchema,
  PageErrorEventSchema,
  SavedFlowSchema,
  SubmitEventSchema,
} from './schemas';

export type NavigateEvent = z.infer<typeof NavigateEventSchema>;
export type ClickEvent = z.infer<typeof ClickEventSchema>;
export type InputEvent = z.infer<typeof InputEventSchema>;
export type SubmitEvent = z.infer<typeof SubmitEventSchema>;
export type FlowEvent = z.infer<typeof FlowEventSchema>;
export type FlowMeta = z.infer<typeof FlowMetaSchema>;
export type FlowDocument = z.infer<typeof FlowDocumentSchema>;

export type PageErrorEvent = z.infer<typeof PageErrorEventSchema>;
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;
export type HistoryBatch = z.infer<typeof HistoryBatchSchema>;
export type HistorySessionLine = z.infer<typeof HistorySessionLineSchema>;
export type HistoryAppendResult = z.infer<typeof HistoryAppendResultSchema>;

export type SavedFlow = z.infer<typeof SavedFlowSchema>;

/** One row of `GET /__flowtape/flows`. */
export interface FlowSummary {
  slug: string;
  name: string;
  updatedAt: string;
  events: number;
}

/** One row of `flowtape history`. */
export interface HistoryFileSummary {
  file: string;
  size: number;
  mtime: Date;
}
