import { describe, expect, it, vi } from 'vitest';
import { createJevClient, JEV_MODEL, JEV_URL, JevError, type JevRequest } from '../src/script/jev';

const request: JevRequest = {
  state: { page: 'ft_page' },
  questions: {
    present: { type: 'noul', instructions: 'Is the button visible in `page`?', criteria: { true: 'yes', false: 'no' } },
    where: { type: 'box', instructions: 'the button as it appears in `page`' },
  },
  assets: { ft_page: { type: 'image', format: 'png', data_base64: 'AAAA' } },
};
const answers = { present: { type: 'noul', noul: 0.9 }, where: { type: 'box', box: { top: 0.1, bottom: 0.2, left: 0.3, right: 0.4 }, confidence: 0.8 } };
const ok = () => new Response(JSON.stringify({ model: JEV_MODEL, answers }), { status: 200 });

describe('createJevClient', () => {
  it('posts the documented request', async () => {
    const fetchMock = vi.fn(async () => ok());
    const result = await createJevClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch }).ask(request);
    expect(result.answers).toEqual(answers);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(JEV_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true' });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(JEV_MODEL);
    expect(JEV_MODEL).toBe('jev-1.14.0');
    expect(body.assets).toEqual({ ft_page: { type: 'image', format: 'png', data_base64: 'AAAA' } });
    expect(Array.isArray(body.questions)).toBe(false);
    expect(body.questions).toEqual(request.questions);
    expect(Object.keys(body.questions)).toEqual(['present', 'where']);
    expect(typeof body.state).toBe('object');
    expect(Array.isArray(body.state)).toBe(false);
    expect(Object.values(body.state)).toEqual(Object.keys(body.assets));
  });

  it('retries on 429 and 5xx, then succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(new Response('', { status: 529 })).mockResolvedValueOnce(ok());
    const result = await createJevClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch, backoffMs: 1 }).ask(request);
    expect(result.answers).toEqual(answers);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 400 and gives up after the retry limit', async () => {
    const bad = vi.fn(async () => new Response('', { status: 400 }));
    await expect(createJevClient({ apiKey: 'k', fetch: bad as unknown as typeof fetch, backoffMs: 1 }).ask(request)).rejects.toMatchObject({ status: 400 });
    expect(bad).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => new Response('', { status: 503 }));
    await expect(createJevClient({ apiKey: 'k', fetch: down as unknown as typeof fetch, backoffMs: 1, retries: 2 }).ask(request)).rejects.toBeInstanceOf(JevError);
    expect(down).toHaveBeenCalledTimes(3);
  });

  it('rejects a response whose answers are an array or miss an id', async () => {
    for (const bad of [[{ type: 'noul', noul: 1 }], { present: answers.present }]) {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: bad }), { status: 200 }));
      await expect(createJevClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch }).ask(request)).rejects.toBeInstanceOf(JevError);
    }
  });

  it('aborts a request that exceeds the timeout', async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    await expect(createJevClient({ apiKey: 'k', fetch: hang as unknown as typeof fetch, timeoutMs: 20 }).ask(request)).rejects.toThrow(/timed out/);
  });
});
