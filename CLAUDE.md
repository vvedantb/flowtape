# Claude notes

See `AGENTS.md` for releases and checks.

## Tests

- The default is no new test.
- A test must call real code: import and exercise it, or render a component.
- Never read or regex source files, CSS or markdown as a stand-in for behaviour. `npm run lint:tests` rejects tests that read source paths as text.
- A regression test must fail on the old code, and it must run in CI (`npm test`).
