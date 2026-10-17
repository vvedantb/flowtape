import { describe, expect, it, vi } from 'vitest';
import { createJevClient, JEV_MODEL, JEV_URL, JevError, type JevRequest } from '../src/script/jev';

const request: JevRequest = {
  state: 'Page: ft_page',
  questions: [{ type: 'noul', instructions: 'Is it there?', criteria: { true: 'yes', false: 'no' } }, { type: 'box', instructions: 'the button in `ft_page`' }],
  assets: { ft_page: { type: 'image', format: 'png', data_base64: 'AAAA' } },
};
const answers = [{ type: 'noul', noul: 0.9 }, { type: 'box', box: { top: 0.1, bottom: 0.2, left: 0.3, right: 0.4 }, confidence: 0.8 }];
const ok = () => new Response(JSON.stringify({ answers }), { status: 200 });

describe('createJevClient', () => {
  it('posts the documented request', async () => {
    const fetchMock = vi.fn(async () => ok());
    const result = await createJevClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch }).ask(request);
    expect(result).toEqual(answers);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(JEV_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true' });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(JEV_MODEL);
    expect(JEV_MODEL).toBe('jev-1.14.0');
    expect(body.assets).toEqual({ ft_page: { type: 'image', format: 'png', data_base64: 'AAAA' } });
    expect(body.questions).toEqual(request.questions);
    expect(body.state).toBe(request.state);
  });

  it('retries on 429 and 5xx, then succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(new Response('', { status: 529 })).mockResolvedValueOnce(ok());
    const result = await createJevClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch, backoffMs: 1 }).ask(request);
    expect(result).toEqual(answers);
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

  it('aborts a request that exceeds the timeout', async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    await expect(createJevClient({ apiKey: 'k', fetch: hang as unknown as typeof fetch, timeoutMs: 20 }).ask(request)).rejects.toThrow(/timed out/);
  });
});
