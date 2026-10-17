// The build adds a 'use client' banner, so a Server Component layout can render this overlay directly.
import { FlowtapeOverlay as Overlay, type FlowtapeOverlayProps } from './client/overlay';
import { NEXT_ENDPOINT } from './next-endpoint';

export { NEXT_ENDPOINT };
export type { FlowtapeOverlayProps };

/** The overlay with `endpoint` set to the Next.js route, `/api/flowtape`. */
export function FlowtapeOverlay({ endpoint = NEXT_ENDPOINT, ...props }: FlowtapeOverlayProps) {
  return <Overlay endpoint={endpoint} {...props} />;
}
