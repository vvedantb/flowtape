/** Thin client for Jev (TypeSafe System One). Plain `fetch`, no SDK. */

export const JEV_MODEL = 'jev-1.14.0';
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string; criteria: { true: string; false: string } }
  | { type: 'box'; instructions: string };

export interface JevAsset {
  type: 'image';
  format: 'png';
  /** Raw base64, no `data:` prefix. */
  data_base64: string;
}

export interface JevRequest {
  state: string;
  questions: JevQuestion[];
  assets?: Record<string, JevAsset>;
}

export interface JevBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; legend: string; probabilities: number[]; confidence: number }
  | { type: 'box'; box: JevBox; confidence: number };

export interface JevClient {
  /** One answer per question, in order. */
  ask(request: JevRequest): Promise<JevAnswer[]>;
}

export interface JevClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  url?: string;
  /** Per attempt. Default 30000. */
  timeoutMs?: number;
  /** Retries after the first attempt, on 429, 529 and 5xx. Default 3. */
  retries?: number;
  /** First retry delay, doubled each time. Default 500. */
  backoffMs?: number;
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'JevError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const retryable = (status: number) => status === 429 || status === 529 || status >= 500;

export function createJevClient(options: JevClientOptions): JevClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retries ?? 3;
  const backoffMs = options.backoffMs ?? 500;

  async function attempt(body: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(options.url ?? JEV_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
          // Required for images and box questions.
          'TypeSafe-Danger-Zone-Images': 'true',
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new JevError(`Jev request timed out after ${timeoutMs} ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async ask(request) {
      const body = JSON.stringify({ model: JEV_MODEL, ...request });
      for (let n = 0; ; n++) {
        const response = await attempt(body);
        if (response.ok) {
          const json = (await response.json()) as { answers?: JevAnswer[] };
          if (!Array.isArray(json.answers) || json.answers.length !== request.questions.length) throw new JevError('Unexpected Jev response: answers missing or wrong length');
          return json.answers;
        }
        if (!retryable(response.status) || n >= retries) throw new JevError(`Jev request failed with HTTP ${response.status}`, response.status);
        await sleep(backoffMs * 2 ** n);
      }
    },
  };
}
