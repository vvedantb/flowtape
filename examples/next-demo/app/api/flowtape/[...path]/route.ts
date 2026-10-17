import { flowtapeRouteHandlers } from '@vvedantb/flowtape/next';

// Serves /api/flowtape/* under `next dev` only. Writes to examples/next-demo/.flowtape/.
export const { GET, POST } = flowtapeRouteHandlers();
