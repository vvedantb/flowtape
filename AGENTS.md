# Agent notes

## Releases

Add a changeset for every user-facing change to `@vvedantb/flowtape`. Run `npm run changeset` and commit the generated file in `.changeset/`. Do not edit the package version or `CHANGELOG.md` by hand. See `RELEASING.md`.

Do not run `npm publish` or `changeset publish` locally. CI publishes.

## Checks

Run `npm run build`, `npm run typecheck`, `npm run lint:tests` and `npm test` before you finish. CI runs the same steps. It does not run Playwright e2e (`npm run test:e2e`, local only).

## Tests

The default is no new test. A test must call real code: import and exercise it, or render a component. Never read or regex source files, CSS or markdown as a stand-in for behaviour. `npm run lint:tests` enforces this. A regression test must fail on the old code, and it must run in CI (`npm test`).
