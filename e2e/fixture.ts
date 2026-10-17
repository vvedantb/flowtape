import http from 'node:http';
import type { AddressInfo } from 'node:net';

const original = `<!doctype html><meta charset="utf-8"><title>Fixture</title>
<h1>Notes</h1>
<label for="note">Note</label>
<input id="note" data-testid="note-input" type="text" placeholder="Write a note">
<label for="pw">Password</label>
<input id="pw" data-testid="pw-input" type="password">
<button id="add" class="btn primary" data-testid="add-btn">Add note</button>
<script>
  document.getElementById('add').addEventListener('click', () => {
    const out = document.createElement('p');
    out.setAttribute('role', 'status');
    out.textContent = 'Added: ' + document.getElementById('note').value;
    document.body.append(out);
  });
</script>`;

// Same page after a refactor: ids and classes renamed, data-testid gone, button moved into a wrapper.
// Accessible names and visible text are unchanged.
const mutated = `<!doctype html><meta charset="utf-8"><title>Fixture</title>
<h1>Notes</h1>
<div class="toolbar"><div class="slot"><button class="cta">Add note</button></div></div>
<label>Note <input class="field-a" type="text" placeholder="Write a note"></label>
<label>Password <input class="field-b" type="password"></label>
<script>
  document.querySelector('.cta').addEventListener('click', () => {
    const out = document.createElement('p');
    out.setAttribute('role', 'status');
    out.textContent = 'Added: ' + document.querySelector('.field-a').value;
    document.body.append(out);
  });
</script>`;

// An auth-style redirect chain on load: a client URL rewrite, a slow request, a full page load and a server redirect.
const login = `<!doctype html><meta charset="utf-8"><title>Signing in</title>
<p>Signing in…</p>
<script>
  history.replaceState(null, '', '/login?ready=1');
  fetch('/slow').then(() => { location.href = '/callback?ticket=one-time-ticket'; });
</script>`;

/**
 * Static fixture on a random local port. `/?variant=mutated` serves the refactored page.
 * `/login` redirects to `/?from=login` through `/callback`. `/magic?token=…` redirects to `/?from=magic`.
 */
export async function startFixture(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/slow') {
      setTimeout(() => res.end('ok'), 800);
      return;
    }
    // A magic sign-in link: the page loads with `token=` (redacted on record), then redirects in JavaScript,
    // as an SPA auth callback does. A server 302 never commits the token URL, so it needs no handling.
    if (url.pathname === '/magic') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><title>Signing in</title><script>setTimeout(() => location.replace('/?from=magic'), 100);</script>`);
      return;
    }
    if (url.pathname === '/callback') {
      res.writeHead(302, { Location: '/?from=login' });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/login') res.end(login);
    else res.end(url.searchParams.get('variant') === 'mutated' ? mutated : original);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
