# flowtape

flowtape records a user journey in your running Vite + React app and turns it into a prompt that Claude Code can replay and explore. You click **Record** in a small in-app overlay, use the app as normal, then click **Stop** and **Export**. flowtape writes the flow as JSON and as a Markdown prompt with steps, assertions, fuzz hints and limits. In development it also keeps a **session history**: an always-on, redacted log of what you did in each browser session, so an agent can review recent activity. It is local-first. There is no account, no cloud service and no browser extension. Passwords, masked fields and secret-looking values are redacted before anything is stored.

## Add it to a Vite app

```sh
npm install -D @vvedantb/flowtape
```

Add the plugin. It serves `/__flowtape/*` during `vite dev` only.

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { flowtape } from '@vvedantb/flowtape/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [flowtape(), react()],
});
```

Mount the overlay once, next to your app.

```tsx
import { FlowtapeOverlay } from '@vvedantb/flowtape';

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
| `sessionHistory` | shared page history | Supply your own `createSessionHistory({ capture })`, for example with `defaultEnabled: false`. Share one `createCapture()` with `createRecorder({ capture })` so each event is captured once. |

## Record, stop, name, export

1. Click **Record**. flowtape logs the current page, then every click, field value, form submit and client-side navigation (`pushState`, `replaceState`, `popstate`, `hashchange`).
2. Use the app. The overlay shows the event count and the last event.
3. Click **Stop**.
4. Type a name, for example `Login and add note`. The name becomes the file slug (`login-and-add-note`).
5. Click **Export**. The overlay shows the saved prompt path and a **Copy prompt** button.

Clicks inside the overlay are ignored. Text typing is debounced, so each field records its final value once. The recording survives component remounts and hot reloads, but not a full page load.

## Session history

Named flows and session history are separate:

| | Record flow | Session history |
| --- | --- | --- |
| Starts | When you click **Record** | Automatically in development (on by default) |
| Ends | When you click **Stop** | When you switch it off or close the tab |
| Output | `flows/<slug>.json` and `prompts/<slug>.md` on **Export** | `history/<YYYY-MM-DD>-<sessionId>.jsonl`, appended every second |
| Git | Committed | Ignored |

Session history uses the same page listeners, event model and redaction as named recording, so both can run at once and each click is captured once. It logs navigations, clicks, field values (type-only for masked fields), form submits, and uncaught errors and unhandled promise rejections. Error lines keep only a scrubbed message, file, line and column, never a stack. flowtape does not capture network traffic, so history never contains request bodies, cookies or `Authorization` headers.

A session is one browser tab. Reloading appends to the same file; a new tab starts a new file. The first line of each file is a `session` envelope (id, start time, start URL, user agent, viewport). Every later line is one event, where `ts` is milliseconds since the session started. History is never turned into a named flow automatically; use **Record** for that.

**Toggle it** with the **Session history** switch at the bottom of the overlay. When it is on, the overlay shows the session id, the event count and the file path. The choice is saved in `localStorage` under `flowtape:history` (`1` or `0`), so it survives reloads.

**Review it with an agent.** Point Claude Code at the folder:

```sh
claude "Read the latest files in .flowtape/history/ and summarise what I did in the app and any errors I hit"
```

**List it from the terminal:**

```sh
npx @vvedantb/flowtape history            # nearest .flowtape/history/ at or above the current folder
npx @vvedantb/flowtape history ./my-app   # or start from another folder
npm run history                 # in this repo: the demo's history
```

Each row shows the modified time (UTC), size and file path, newest first.

## Where files land

```
<vite root>/.flowtape/
  flows/<slug>.json                        # FlowDocument (version 1), validated with Zod
  prompts/<slug>.md                        # Claude Code prompt generated from the flow
  history/<YYYY-MM-DD>-<sessionId>.jsonl   # session history, gitignored
```

Flows and prompts are **meant to be committed**. They act as living, reviewable test journeys. Session history is personal and noisy, so add it to your `.gitignore`:

```gitignore
**/.flowtape/history/
```

This repo's `.gitignore` already does, and a test checks that history is ignored while flows and prompts are not. The plugin tells Vite's watcher to ignore `.flowtape/**` so that saving and appending do not reload the page. Exporting under the same name overwrites the previous files.

The middleware also exposes:

| Route | Returns |
| --- | --- |
| `GET /__flowtape/health` | `{ ok: true, enabled: true }` |
| `GET /__flowtape/flows` | Saved flows, newest first |
| `GET /__flowtape/flows/:slug` | One flow |
| `POST /__flowtape/flows` | Validates, redacts, writes the flow and prompt |
| `POST /__flowtape/history` | Validates `{ sessionId, startedAt, startUrl?, meta?, events }`, redacts and appends to the session file |

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

## Replay scripts

The overlay produces prompts for an AI to read. A **replay script** is the other output: a versioned JSON file that Playwright can replay without an AI. It is a separate format from the overlay flow (`FlowDocument`, version 1) and has its own `version`.

```sh
npx @vvedantb/flowtape record http://localhost:5173 --out .flowtape/scripts/login.json
npx @vvedantb/flowtape replay .flowtape/scripts/login.json
```

`record` opens Chromium (headless by default, `--headed` to see it), records until you press Ctrl+C or close the window, then writes the script. The default path is `.flowtape/scripts/<name>.json`. `--name` sets the script name.

| `replay` flag | Meaning |
| --- | --- |
| `--jev` | Use Jev for targets that selectors cannot find. Fails if `TYPESAFE_API_KEY` is not set. |
| `--no-jev` | Selector-only. Never calls the network. |
| `--threshold <0-1>` | Minimum confidence per step. Default `0.7`. |
| `--headed` | Show the browser. |

With neither `--jev` nor `--no-jev`, replay uses Jev only when `TYPESAFE_API_KEY` is set.

### How replay works

For each step, replay waits for network idle and for the DOM to stay quiet for 300 ms. It then tries the recorded selectors in order and uses the first that matches exactly one element: `test-id`, `role` (with accessible name), `label`, `placeholder`, `text`, then `css`. After the action it checks the step's `expected` outcome (URL or element). A selector hit has confidence 1.

If every selector misses and Jev is on, replay sends the current page screenshot and the recorded crop of the target to Jev. It asks whether the target is visible and where it is, then clicks the centre of the box. Jev also checks the expected outcome visually when the URL or element check fails. Jev answers use the confidence it returns. A step below the threshold fails.

A failed replay exits with code 1. It prints the step, the selectors tried, the reason and the paths of before and after screenshots, which it saves under `.flowtape/replay-failures/` (git-ignored).

### Script format

```json
{
  "version": 1,
  "kind": "flowtape-replay-script",
  "id": "…",
  "name": "Add a note",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "startUrl": "http://localhost:5173/",
  "viewport": { "width": 1280, "height": 720 },
  "steps": [
    {
      "type": "click",
      "ts": 2310,
      "url": "http://localhost:5173/",
      "selectors": [
        { "strategy": "test-id", "value": "add-btn" },
        { "strategy": "role", "role": "button", "name": "Add note", "value": "Add note" },
        { "strategy": "text", "value": "Add note" },
        { "strategy": "css", "value": "[data-testid=\"add-btn\"]" }
      ],
      "expected": { "kind": "none" },
      "screenshots": { "page": "<base64 png>", "target": "<base64 png>" }
    }
  ]
}
```

- **`type`** is `click`, `type`, `select`, `navigate`, `scroll` or `key` (Enter, Escape, Tab). Typing, `value`, `key` and `scroll` carry the action data.
- **`expected`** is `{ "kind": "url", "url": "/path" }`, `{ "kind": "element", "selector": "…" }` or `{ "kind": "none" }`. Recording sets `url` when the URL changed after the step. You can edit a script to add an `element` check.
- **Redirects** that the app or server starts on its own (an auth callback, a router rewrite, a `302`) are not steps. While requests are still in flight, or within 300 ms of the last one, each new URL updates the `expected` URL of the step before it. A redirect chain on load leaves `startUrl` as the first URL and records no steps. A chain stays open for at most 5 s (`redirectMs` in `recordScript`).
- **`screenshots`** are raw base64 PNGs (no `data:` prefix). Replay pads and scales them to meet Jev image limits (each side 280 to 1568 px).
- The script is validated with `ReplayScriptSchema`. Import it from `@vvedantb/flowtape`. The Node API (`recordScript`, `replayScript`, `createJevClient`) is in `@vvedantb/flowtape/node`.

### Password masking

Replay scripts use the same redaction as the overlay. Password fields, `data-flowtape-mask` areas and secret-looking field names record `redacted: true`, `value: null` and the value's length. Redacted steps carry no screenshots, and masked fields are blanked in all other screenshots.

On replay, a redacted field is filled from an environment variable named after the field, for example `FLOWTAPE_PASSWORD`. If the variable is not set, replay leaves the field empty and notes this in the step output. It never invents a secret.

### Jev (optional)

Jev is the TypeSafe System One visual model (`jev-1.14.0`, `https://api.typesafe.ai/v1/systemone`). Set `TYPESAFE_API_KEY` to turn it on. Without a key, replay is selector-only and makes no network calls. With Jev on, page and target screenshots leave your machine, so check that they are safe to share. Image input is experimental.

## Redaction

Redaction runs three times: in the browser as events are recorded, on the server before files are written, and over the final Markdown. Session history gets the first two.

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
npm run test:e2e     # Playwright: records a real flow and session history in the demo, and records and replays a script against a local fixture
```

Requires Node 18 or later.

## Follow-ups (out of scope for now)

- **Next.js plugin**: the same middleware for `next dev`.
- **Explore / fuzz agent loop**: run the prompt automatically and collect findings.
- **Full page loads**: keep recording across hard navigations (multi-page apps).
- **Browser extension**: explicitly out of scope. flowtape records in-app through the SDK only.
