# flowtape

flowtape records a user journey in your running Vite + React app and turns it into a prompt that Claude Code can replay and explore. You click **Record** in a small in-app overlay, use the app as normal, then click **Stop** and **Export**. flowtape writes the flow as JSON and as a Markdown prompt with steps, assertions, fuzz hints and limits. It is local-first. There is no account, no cloud service and no browser extension. Passwords, masked fields and secret-looking values are redacted before anything is stored.

## Add it to a Vite app

```sh
npm install -D @vedantb/flowtape
```

Add the plugin. It serves `/__flowtape/*` during `vite dev` only.

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { flowtape } from '@vedantb/flowtape/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [flowtape(), react()],
});
```

Mount the overlay once, next to your app.

```tsx
import { FlowtapeOverlay } from '@vedantb/flowtape';

createRoot(root).render(
  <>
    <App />
    <FlowtapeOverlay />
  </>,
);
```

The overlay renders only outside production builds. Pass `enabled` to force it on or off. To keep it out of your production bundle entirely, render it behind `import.meta.env.DEV`.

| Plugin option | Default | Meaning |
| --- | --- | --- |
| `enabled` | on for `vite dev` | Turn the middleware on or off. |
| `dir` | `.flowtape` | Output folder, relative to the Vite root. |

| Overlay prop | Default | Meaning |
| --- | --- | --- |
| `enabled` | on outside production | Show or hide the overlay. |
| `endpoint` | `/__flowtape` | Base URL of the middleware. |
| `recorder` | shared page recorder | Supply your own `createRecorder()` instance. |

## Record, stop, name, export

1. Click **Record**. flowtape logs the current page, then every click, field value, form submit and client-side navigation (`pushState`, `replaceState`, `popstate`, `hashchange`).
2. Use the app. The overlay shows the event count and the last event.
3. Click **Stop**.
4. Type a name, for example `Login and add note`. The name becomes the file slug (`login-and-add-note`).
5. Click **Export**. The overlay shows the saved prompt path and a **Copy prompt** button.

Clicks inside the overlay are ignored. Text typing is debounced, so each field records its final value once. The recording survives component remounts and hot reloads, but not a full page load.

## Where files land

```
<vite root>/.flowtape/
  flows/<slug>.json     # FlowDocument (version 1), validated with Zod
  prompts/<slug>.md     # Claude Code prompt generated from the flow
```

Flows and prompts are **meant to be committed**. They act as living, reviewable test journeys. flowtape does not add them to `.gitignore`, and the plugin tells Vite's watcher to ignore `.flowtape/**` so that saving does not reload the page. Exporting under the same name overwrites the previous files.

The middleware also exposes:

| Route | Returns |
| --- | --- |
| `GET /__flowtape/health` | `{ ok: true, enabled: true }` |
| `GET /__flowtape/flows` | Saved flows, newest first |
| `GET /__flowtape/flows/:slug` | One flow |
| `POST /__flowtape/flows` | Validates, redacts, writes the flow and prompt |

## Feed the prompt to Claude Code

Each prompt has these sections: **Goal**, **Preconditions**, **Steps**, **Assertions**, **Fuzz hints**, **Out of bounds** and **Report back**. Assertions and fuzz hints are heuristics. Fill in the `TODO` lines (seed data, final-state checks) before you rely on them.

Start your dev server. Give Claude Code a browser tool (for example Playwright MCP). Then run one of these:

```sh
# Interactive: reference the file in your message
claude "Follow @.flowtape/prompts/login-and-add-note.md against the running app"

# Headless
claude -p "$(cat .flowtape/prompts/login-and-add-note.md)"
```

Redacted fields name an environment variable, such as `$FLOWTAPE_PASSWORD`. Set these to **test** credentials in the shell that runs Claude Code. The prompt tells the agent never to print, log or screenshot them.

## Redaction

Redaction runs three times: in the browser as events are recorded, on the server before files are written, and over the final Markdown.

- **`input[type=password]`**: the value is never stored. The event keeps `redacted: true`, `value: null` and the value's length.
- **`data-flowtape-mask`**: put this on a field or any ancestor. Every field inside is recorded type-only in the same way. Click text inside a masked area is dropped too.
- **Secret-looking field names**: fields whose `name`, `id` or `autocomplete` suggests a secret (password, token, API key, OTP, card number, CVC and so on) are treated as masked. This covers "show password" toggles that switch the field to `type="text"`.
- **Pattern scrub**: every stored string (values, selectors, labels, URLs, hrefs, form actions) is scrubbed for secret shapes and replaced with `[REDACTED]`:
  - `password=`, `token=`, `api_key=` and similar query or form pairs
  - `Bearer …` headers and JWTs
  - `sk-…`, `sk_live_…`, `ghp_…`, `github_pat_…`, `AKIA…`, `xox…-`, `AIza…`
  - `user:pass@` in URLs and PEM private keys
  - long mixed-case base64 runs and long hex strings

The pattern scrub is a safety net, not a guarantee. Mask sensitive fields explicitly with `data-flowtape-mask`, and review a flow before you commit it. `test/prompt-secret-leak.test.ts` plants tokens in values, selectors, URLs and hrefs, then checks that none reach the prompt or the saved JSON.

## Demo

`examples/vite-demo` is a small app with synthetic data only. It has a fake sign-in form (email, password and a masked "Member ID"), a notes list and an add-note form.

```sh
npm install
npm run dev          # builds the package, then starts the demo at http://localhost:5180
```

Open the demo, click **Record**, sign in with any email, add a note, then click **Stop**, name the flow and click **Export**. The files appear under `examples/vite-demo/.flowtape/`. A committed sample recording is in `examples/vite-demo/.flowtape/flows/login-and-add-note.json` and `examples/vite-demo/.flowtape/prompts/login-and-add-note.md`.

## Development

```sh
npm run build        # package (tsup, ESM + CJS + types) and demo
npm test             # Vitest unit tests
npm run typecheck    # package, demo and e2e
npm run test:e2e     # Playwright: records a real flow in the demo and checks the files
```

Requires Node 18 or later.

## Follow-ups (out of scope for now)

- **Next.js plugin**: the same middleware for `next dev`.
- **Explore / fuzz agent loop**: run the prompt automatically and collect findings.
- **Full page loads**: keep recording across hard navigations (multi-page apps).
- **Browser extension**: explicitly out of scope. flowtape records in-app through the SDK only.
