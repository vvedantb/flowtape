/** Node only. Playwright is an optional peer dependency: only `record` and `replay` need it. */
export async function loadChromium(): Promise<typeof import('playwright').chromium> {
  try {
    return (await import('playwright')).chromium;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') throw error;
    throw new Error('flowtape record and replay need Playwright. Install it with `npm install -D playwright` and `npx playwright install chromium`.');
  }
}
