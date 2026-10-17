/** Node only. Next.js route handlers for the flowtape endpoint. No `next` import, so any Next.js version works. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NEXT_ENDPOINT } from './next-endpoint';
import { MAX_BODY, RESPONSE_HEADERS, handleRequest, readBody, writeResponse, type FlowtapeServerOptions } from './server';

export { appendHistory, findHistoryDir, listFlows, listHistory, readFlow, saveFlow } from './server';
export type { FlowtapeServerOptions } from './server';

export { NEXT_ENDPOINT };

export interface FlowtapeNextOptions {
  /** Force on or off. Default: on when `NODE_ENV` is `development` (`next dev`). */
  enabled?: boolean;
  /** Output folder, relative to `root`. Default `.flowtape`. */
  dir?: string;
  /** Project root. Default `process.cwd()`, which is the app folder under `next dev`. */
  root?: string;
  /** URL path of the catch-all route. Must match the overlay's `endpoint` prop. Default `/api/flowtape`. */
  endpoint?: string;
}

/** Bind the options once and return the route part of a URL (`flows`, `history`, `flows/<slug>`). */
function setup(options: FlowtapeNextOptions) {
  const endpoint = options.endpoint ?? NEXT_ENDPOINT;
  return {
    server: (): FlowtapeServerOptions => ({ root: options.root ?? process.cwd(), dir: options.dir, enabled: options.enabled ?? process.env.NODE_ENV === 'development' }),
    route(url: string): string {
      const { pathname } = new URL(url, 'http://localhost');
      // `indexOf` and not `startsWith`, so a Next.js `basePath` in front of the endpoint still matches.
      const at = pathname.indexOf(`${endpoint}/`);
      return at < 0 ? '' : pathname.slice(at + endpoint.length + 1);
    },
  };
}

type RouteHandler = (request: Request) => Promise<Response>;

/**
 * App Router handlers. In `app/api/flowtape/[...path]/route.ts`:
 *
 * ```ts
 * export const { GET, POST } = flowtapeRouteHandlers();
 * ```
 */
export function flowtapeRouteHandlers(options: FlowtapeNextOptions = {}): { GET: RouteHandler; POST: RouteHandler } {
  const { server, route } = setup(options);
  const handler: RouteHandler = async (request) => {
    const { status, body } = await handleRequest(server(), request.method, route(request.url), async () => {
      const text = await request.text();
      if (text.length > MAX_BODY) throw new Error('Body too large');
      return text;
    });
    return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS });
  };
  return { GET: handler, POST: handler };
}

/** A Pages Router request. Next.js has already parsed `body`, unless the route turns `bodyParser` off. */
type PagesRequest = IncomingMessage & { body?: unknown };

/**
 * Pages Router API route. In `pages/api/flowtape/[...path].ts`:
 *
 * ```ts
 * export default flowtapeApiHandler();
 * ```
 */
export function flowtapeApiHandler(options: FlowtapeNextOptions = {}): (req: PagesRequest, res: ServerResponse) => Promise<void> {
  const { server, route } = setup(options);
  return async (req, res) => {
    // The built-in body parser has already read the stream, so the parsed body goes back as text.
    const read = async () => (req.body === undefined ? readBody(req) : typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    writeResponse(res, await handleRequest(server(), req.method ?? 'GET', route(req.url ?? '/'), read));
  };
}
