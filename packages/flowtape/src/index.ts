export { FlowtapeOverlay, DEFAULT_ENDPOINT } from './client/overlay';
export type { FlowtapeOverlayProps } from './client/overlay';
export { createRecorder, createFlowDocument, selectorFor, roleFor, nameFor, UI_ATTR } from './recorder';
export type { Recorder, RecorderOptions, RecorderSnapshot, CreateFlowInput } from './recorder';
export { MASK_ATTR, REDACTED, scrubText, isSensitiveName, isMaskedElement, redactEvent, redactInput, redactFlow } from './redact';
export { flowToPrompt, envVarFor } from './prompt';
export type { PromptOptions } from './prompt';
export * from './schemas';
export type * from './types';
