/** Thin client for Jev (TypeSafe System One). Plain `fetch`, no SDK. */

export const JEV_MODEL = 'jev-1.14.0';
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'box'; instructions: string };

export interface JevAsset {
  type: 'image';
  format: 'png';
  /** Raw base64, no `data:` prefix. */
  data_base64: string;
}

export interface JevRequest {
  /** An object whose values reference asset keys, so questions can use backtick paths such as `page`. */
  state: string | Record<string, string>;
  /** Keyed by ids you choose. */
  questions: Record<string, JevQuestion>;
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
  | { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number }
  | { type: 'box'; box: JevBox; confidence: number };

export interface JevResult {
  model?: string;
  /** Same ids as the request's `questions`. */
  answers: Record<string, JevAnswer>;
  usage?: unknown;
}

export interface JevClient {
  ask(request: JevRequest): Promise<JevResult>;
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
          const json = (await response.json()) as Partial<JevResult>;
          const answers = json.answers;
          if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(request.questions).some((id) => !(id in answers))) throw new JevError('Unexpected Jev response: answers missing for some questions');
          return { model: json.model, answers, usage: json.usage };
        }
        if (!retryable(response.status) || n >= retries) throw new JevError(`Jev request failed with HTTP ${response.status}`, response.status);
        await sleep(backoffMs * 2 ** n);
      }
    },
  };
}
