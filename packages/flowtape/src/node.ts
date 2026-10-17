/** Node entry: record and replay scripts. Imports Playwright, so never bundle it for the browser. */
export { recordScript, recordCommand, expectedUrl } from './script/record';
export type { RecordOptions, ScriptRecording } from './script/record';
export { replayScript, replayCommand, formatFailure } from './script/replay';
export type { ReplayOptions, ReplayPage, ReplayLocator, ReplayResult, ReplayFailure, StepResult, TriedSelector } from './script/replay';
export { createJevClient, JevError, JEV_MODEL, JEV_URL } from './script/jev';
export type { JevClient, JevClientOptions, JevQuestion, JevAnswer, JevRequest, JevAsset, JevBox } from './script/jev';
export { fitImage, MIN_SIDE, MAX_SIDE } from './script/image';
export type { FittedImage } from './script/image';
