# flowtape

flowtape records a user journey in your running Vite + React or Next.js app and turns it into a prompt that Claude Code can replay and explore. You click **Record** in a small in-app overlay, use the app as normal, then click **Stop** and **Export**. flowtape writes the flow as JSON and as a Markdown prompt with steps, assertions, fuzz hints and limits. In development it can also keep a **session history**: an opt-in, redacted log of what you did in each browser session, so an agent can review recent activity. It is local-first. There is no account, no cloud service and no browser extension. Passwords, masked fields, secret-looking values and common personal identifiers (NHS numbers, emails, UK postcodes and mobiles) are redacted before anything is stored.

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

The overlay renders only outside production builds. Pass `enabled` to force it on or off. To keep its code out of your production bundle, render it behind `import.meta.env.DEV` (`{import.meta.env.DEV && <FlowtapeOverlay />}`): Vite then tree-shakes the import.

| Plugin option | Default | Meaning |
| --- | --- | --- |
| `enabled` | on for `vite dev` | Turn the middleware on or off. |
| `dir` | `.flowtape` | Output folder, relative to the Vite root. |

| Overlay prop | Default | Meaning |
| --- | --- | --- |
| `enabled` | on outside production | Show or hide the overlay. |
| `endpoint` | `/__flowtape` | Base URL of the middleware. |
| `recorder` | shared page recorder | Supply your own `createRecorder()` instance. |
| `sessionHistory` | shared page history | Supply your own `createSessionHistory({ capture })`, for example with `defaultEnabled: true`. Share one `createCapture()` with `createRecorder({ capture })` so each event is captured once. |

## Add it to a Next.js app

The Vite plugin does not run under `next dev`, so Next.js uses a route handler instead. A folder that starts with `_` is private in the App Router, so the Next.js endpoint is `/api/flowtape`, not `/__flowtape`.

```sh
npm install -D @vvedantb/flowtape
```

**App Router** (Next.js 13.4 or later). Add the route:

```ts
// app/api/flowtape/[...path]/route.ts
import { flowtapeRouteHandlers } from '@vvedantb/flowtape/next';

export const { GET, POST } = flowtapeRouteHandlers();
```

Render the overlay in the root layout. `@vvedantb/flowtape/next/client` is marked `'use client'` and sets `endpoint` to `/api/flowtape`, so a Server Component layout can render it directly. It loads the overlay only under `next dev`: a production build contains none of its code, even though the layout imports it.

```tsx
// app/layout.tsx
import { FlowtapeOverlay } from '@vvedantb/flowtape/next/client';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <FlowtapeOverlay />}
      </body>
    </html>
  );
}
```

**Pages Router** (Next.js 12 or later). Add the API route, and render `<FlowtapeOverlay />` from `@vvedantb/flowtape/next/client` in `pages/_app.tsx`:

```ts
// pages/api/flowtape/[...path].ts
import { flowtapeApiHandler } from '@vvedantb/flowtape/next';

export default flowtapeApiHandler();
```

Next.js parses the body with a 1 MB limit by default. For long recordings, raise it in the same file with `export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };`.

| Handler option | Default | Meaning |
| --- | --- | --- |
| `enabled` | on when `NODE_ENV` is `development` | Turn the route on or off. When off, every route except `health` returns 403 and nothing is written. |
| `dir` | `.flowtape` | Output folder, relative to `root`. |
| `root` | `process.cwd()` | Project root. Under `next dev` this is the app folder. In a monorepo, check that it is the app and not the repo root. |
| `endpoint` | `/api/flowtape` | URL path of the catch-all route. Set the overlay's `endpoint` prop to the same value. A `basePath` in front of it is fine. |

The route uses `node:fs`, so keep it on the Node.js runtime (the default). Do not set `export const runtime = 'edge'`. The route ships in a production build but does nothing there. To leave it out entirely, add it only in development. `examples/next-demo` has both routers.

## Record, stop, name, export

1. Click **Record**. flowtape logs the current page, then every click, field value, form submit and client-side navigation (`pushState`, `replaceState`, `popstate`, `hashchange`).
2. Use the app. The overlay shows the event count and the last event.
3. Click **Stop**.
4. Type a name, for example `Login and add note`. The name becomes the file slug (`login-and-add-note`).
5. Click **Export**. The overlay shows the saved prompt path and a **Copy prompt** button.

Clicks inside the overlay are ignored. Text typing is debounced, so each field records its final value once. The recording survives component remounts, hot reloads and full page loads in the same tab (a reload, a server-rendered form post, `location.href`). It is kept in `sessionStorage` under `flowtape:recording`, holds only redacted events, and ends when the tab closes or you click **Clear**. Typing that is still debounced when the page unloads is saved first. Pass `createRecorder({ persist: false })` to keep it in memory only.

## Assertions while recording

While you record, click **Assert**, choose what to check, then click an element on the page. The app never receives that click. **Esc** or **Cancel** stops picking.

| Check | Click | Recorded |
| --- | --- | --- |
| **Text** (default) | the element | It is visible and shows its current text, or a field's current value. A short value with a number in it (£1,250.00/week, 3 placements) is checked exactly, so "£11,250" cannot pass for "£1,250". |
| **Count** | one of the rows | How many elements match like it (its test id or CSS). |
| **Gone** | the element that should go, then do the action that removes it | It left the page. The overlay waits, and records the check when the element goes, right after the action that removed it. |

A masked element gives a visibility-only check, so its text is never stored. Recorded checks appear in the prompt as **Check:** steps and replace the generic final-state `TODO`. In the e2e export they become `toContainText` or `toHaveText`, `toHaveCount`, and `toBeHidden`.

## Session history

Named flows and session history are separate:

| | Record flow | Session history |
| --- | --- | --- |
| Starts | When you click **Record** | When you switch it on (off by default) |
| Ends | When you click **Stop** | When you switch it off or close the tab |
| Output | `flows/<slug>.json` and `prompts/<slug>.md` on **Export** | `history/<YYYY-MM-DD>-<sessionId>.jsonl`, appended every second |
| Git | Committed | Ignored |

Session history uses the same page listeners, event model and redaction as named recording, so both can run at once and each click is captured once. It logs navigations, clicks, field values (type-only for masked fields), form submits, and uncaught errors and unhandled promise rejections. Error lines keep only a scrubbed message, file, line and column, never a stack. flowtape does not capture network traffic, so history never contains request bodies, cookies or `Authorization` headers.

A session is one browser tab. Reloading appends to the same file; a new tab starts a new file. The first line of each file is a `session` envelope (id, start time, start URL, user agent, viewport). Every later line is one event, where `ts` is milliseconds since the session started. History is never turned into a named flow automatically; use **Record** for that.

**Switch it on** with the **Session history** switch at the bottom of the overlay. It is off by default, because it logs typed values continuously, not only while you record. When it is on, the overlay shows the session id, the event count and the file path. The choice is saved in `localStorage` under `flowtape:history` (`1` or `0`), so it survives reloads.

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
  e2e/<slug>.e2e.ts                        # draft test for the e2e runner
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

## Export to the e2e runner

Every export also writes a draft test for the [`e2e` runner](https://e2e.tester.army) (`@e2e-dev/web`) to `.flowtape/e2e/<slug>.e2e.ts`. It replays the flow with exact steps: no model and no API key. It sits outside the runner's default `tests/**/*.e2e.ts` glob, so review it, then move it into your tests folder.

```ts
// Generated by flowtape from .flowtape/flows/sign-in-and-add-note.json. ...
// Masked values come from the runner's secrets. Declare them in e2e.config.ts: secrets: { "password": () => "" },
// then supply them per run (6+ characters) with E2E_SECRET_PASSWORD.
import { test } from "@e2e-dev/web";
import { expect, secrets } from "e2e";

test("Sign in and add note", { requires: ["browser"] }, async ({ app, screen, browser }) => {
  await app.open("/");
  await screen.getByTestId("login-email").fill("ada@example.test");
  await screen.getByTestId("login-password").fill(secrets.get("password"));
  await screen.getByTestId("login-submit").tap();
  await expect(browser).toHaveURL("/notes");
  await screen.getByTestId("note-input").fill("Water the plants");
  await screen.getByTestId("note-add").tap();
  await expect(screen.getByTestId("note-item").filter({ hasText: "Water the plants" })).toContainText("Water the plants");
});
```

- **Locators** are checked while you record. Each click, field and check stores every strategy (test id, role and accessible name, label, placeholder, text, CSS) with how many visible elements it matched on the page at that moment. The test uses the first one that matched exactly one, so a name that is shared by two buttons or a row that repeats is never picked. A strategy whose value was redacted is skipped, because it cannot match. Flows recorded before this have no match counts and use the old rules: a test id, then role and name, then label, then CSS, narrowed with `filter({ hasText })` or `nth()` when it matched several elements.
- **Masked values** never reach the file. Each becomes `secrets.get("<label in kebab case>")`. Declare it as a provider in `e2e.config.ts`, as the header shows, and set `E2E_SECRET_<NAME>` when you run. The runner needs 6 or more characters.
- **Checks**: navigations caused by a click become `expect(browser).toHaveURL(...)`, and each recorded **Assert** becomes `toBeVisible()` plus `toContainText()` (or `toHaveValue()` for a field). With no recorded check, the test ends with a `TODO`.
- **Sign-in sessions**: write a test for an existing flow with a session from your config:

  ```sh
  npx @vvedantb/flowtape e2e .flowtape/flows/sign-in-and-add-note.json --session testUser --out tests/sign-in-and-add-note.e2e.ts
  ```

flowtape computes accessible names itself, so in rare cases a role locator can still need a small edit. `flowToE2ETest(doc, { session })` is the same generator as a function.

## Replay scripts

The overlay produces prompts for an AI to read. A **replay script** is the other output: a versioned JSON file that Playwright can replay without an AI.

Playwright is an optional peer dependency, so the overlay alone does not install it. Install it for `record` and `replay`:

```sh
npm install -D playwright
npx playwright install chromium
``` It is a separate format from the overlay flow (`FlowDocument`, version 1) and has its own `version`.

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

Recording handles steps one at a time, so it can fall behind a fast user. Navigations it sees while it catches up go on a timeline: a navigation that started before your latest action settled (`settleMs`, nothing in flight, then 500 ms of quiet network) is that action's outcome, even when the server takes seconds to answer. One that started later is yours, and becomes its own step in the right place.

A one-time link (a magic sign-in link, a URL with `token=`) is redacted on record, so it cannot be replayed. When the app redirects from it in JavaScript, the step (or `startUrl`) keeps the clean page it redirects to. A navigation that stays on a redacted URL is left out of the script with a warning (`onWarning` in `recordScript`, a console warning in the CLI).

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

Screenshots follow the same rules as the text:

- **Every screenshot is masked**: recorded page shots, target crops, replay failure shots and anything sent to Jev. Masked fields become solid magenta blocks.
- **A revealed password stays masked.** A field that was ever `type="password"` keeps `data-flowtape-secret`, so a "Show password" toggle that switches it to text cannot unmask it, in data or in pixels. Replay also marks every field it fills from a `FLOWTAPE_*` value.
- **Target crops** are taken of each step's own element. A masked element gets no crop.
- **Allowlist mode takes no screenshots**, in recording and in replay, and replay never calls Jev on such a page. Failure reports say why they have no images.

On replay, a redacted field is filled from an environment variable named after the field, for example `FLOWTAPE_PASSWORD`. If the variable is not set, replay leaves the field empty and notes this in the step output. It never invents a secret.

### Jev (optional)

Jev is the TypeSafe System One visual model (`jev-1.14.0`, `https://api.typesafe.ai/v1/systemone`). Set `TYPESAFE_API_KEY` to turn it on. Without a key, replay is selector-only and makes no network calls. With Jev on, page and target screenshots leave your machine. They are masked as above, but text on the page that no rule masks (a name, an address) is still visible, so check that they are safe to share, and use allowlist mode for pages with personal data. Image input is experimental.

## Redaction

Redaction runs three times: in the browser as events are recorded, on the server before files are written, and over the final Markdown. Session history gets the first two.

- **`input[type=password]`**: the value is never stored. The event keeps `redacted: true`, `value: null` and the value's length.
- **`data-flowtape-mask`**: put this on a field or any ancestor. Every field inside is recorded type-only in the same way. Click text inside a masked area is dropped too. To mask a whole form, put it on the `<form>`:

  ```html
  <form data-flowtape-mask>…every field in here is recorded type-only…</form>
  ```
- **Secret-looking and personal field names**: fields whose `name`, `id`, `autocomplete` or label suggests a secret (password, token, API key, OTP, verification or security code, 2FA, MFA, card number, CVC and so on) or a personal identifier (date of birth, NHS number, National Insurance number) are treated as masked. This covers a field labelled "Date of birth" or "Verification code" with no telling `name`.
- **Revealed passwords**: a field that was ever `type="password"` stays masked after a "show password" toggle switches it to `type="text"`, even with no telling name or label.
- **One-time code fields by shape**: a short field (`maxlength` 4 to 8) or a numeric one (`inputmode="numeric"`) whose label or placeholder mentions a code or PIN is masked.
- **Allowlist mode** (`data-flowtape-allowlist`): for apps that handle personal data. Put it on `<body>` or any container. Inside it, every field is recorded type-only, and links, rows and other non-control elements lose their text, unless the element or an ancestor has `data-flowtape-safe`. Names of buttons, tabs, checkboxes and similar controls are kept, because replay needs them and they are interface labels. Mark the fields that are safe to store:

  ```html
  <body data-flowtape-allowlist>
    <input name="patient-name">                <!-- type-only -->
    <input name="care-tier" data-flowtape-safe> <!-- value stored -->
    <a href="/people/42">Jane Doe</a>           <!-- click kept, text dropped -->
    <button>Save placement</button>             <!-- name kept -->
  </body>
  ```
- **Pattern scrub**: every stored string (values, selectors, labels, URLs, hrefs, form actions) is scrubbed for secret shapes and replaced with `[REDACTED]`:
  - `password=`, `token=`, `api_key=` and similar query or form pairs
  - `Bearer …` headers and JWTs
  - `sk-…`, `sk_live_…`, `ghp_…`, `github_pat_…`, `AKIA…`, `xox…-`, `AIza…`
  - `user:pass@` in URLs and PEM private keys
  - long mixed-case base64 runs and long hex strings
  - NHS numbers (10 digits, grouped or not, that pass the modulus 11 check digit, so other 10-digit ids survive)
  - email addresses, except reserved example domains (`example.com`, `*.test`, `*.example`, `*.invalid`, `*.localhost`) that test accounts and placeholders use
  - UK postcodes and UK mobile numbers
  - 2FA setup keys: base32 runs of 16 or more characters with a digit from 2 to 7, grouped in fours or not (`JBSW Y3DP EHPK 3PXP`)

The pattern scrub is a safety net, not a guarantee. Names, addresses, dates of birth typed into a free-text field and care notes have no reliable shape, so no pattern finds them. In an app that handles personal data, use allowlist mode, mask sensitive forms with `data-flowtape-mask`, and review a flow before you commit it. `test/prompt-secret-leak.test.ts` plants tokens in values, selectors, URLs and hrefs, then checks that none reach the prompt or the saved JSON.

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

- **Explore / fuzz agent loop**: run the prompt automatically and collect findings.
- **Browser extension**: explicitly out of scope. flowtape records in-app through the SDK only.
