import type { Plugin } from 'vite';
import { createMiddleware, type FlowtapeServerOptions } from './server';

export { ENDPOINT, listFlows, readFlow, saveFlow } from './server';
export type { FlowtapeServerOptions } from './server';

export interface FlowtapeViteOptions {
  /** Force on or off. Default: on for `vite dev`, off for `vite build`. */
  enabled?: boolean;
  /** Output folder, relative to the Vite root. Default `.flowtape`. */
  dir?: string;
}

/** Vite plugin: serves `/__flowtape/*` so the overlay can save flows and Claude Code prompts. */
export function flowtape(options: FlowtapeViteOptions = {}): Plugin {
  let root = process.cwd();
  let active = false;
  const serverOptions = (): FlowtapeServerOptions => ({ root, dir: options.dir, enabled: active });

  return {
    name: 'flowtape',
    config() {
      // Saving a flow must not trigger a reload.
      return { server: { watch: { ignored: [`**/${options.dir ?? '.flowtape'}/**`] } } };
    },
    configResolved(config) {
      root = config.root;
      active = options.enabled ?? config.command === 'serve';
    },
    configureServer(server) {
      server.middlewares.use(createMiddleware(serverOptions));
    },
  };
}

export default flowtape;
