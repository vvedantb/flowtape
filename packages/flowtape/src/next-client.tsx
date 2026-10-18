// The build adds a 'use client' banner, so a Server Component layout can render this overlay directly.
import { lazy, Suspense } from 'react';
import type { FlowtapeOverlayProps } from './client/overlay';
import { NEXT_ENDPOINT } from './next-endpoint';

export { NEXT_ENDPOINT };
export type { FlowtapeOverlayProps };

// Next.js replaces `process.env.NODE_ENV` at build time. In a production build this is `null`, so the
// bundler drops the `import()` and the overlay chunk. A static import would ship it even when it never renders.
const DevOverlay =
  process.env.NODE_ENV === 'development' ? lazy(() => import('./client/overlay').then((module) => ({ default: module.FlowtapeOverlay }))) : null;

/**
 * The overlay with `endpoint` set to the Next.js route, `/api/flowtape`. It renders only under `next dev`,
 * and production builds do not include its code. To show it in another build, use `FlowtapeOverlay`
 * from `@vvedantb/flowtape` with `enabled`.
 */
export function FlowtapeOverlay({ endpoint = NEXT_ENDPOINT, ...props }: FlowtapeOverlayProps) {
  if (!DevOverlay) return null;
  return (
    <Suspense fallback={null}>
      <DevOverlay endpoint={endpoint} {...props} />
    </Suspense>
  );
}
