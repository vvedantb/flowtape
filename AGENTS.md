# Agent notes

## Releases

Add a changeset for every user-facing change to `@vvedantb/flowtape`. Run `npm run changeset` and commit the generated file in `.changeset/`. Do not edit the package version or `CHANGELOG.md` by hand. See `RELEASING.md`.

Do not run `npm publish` or `changeset publish` locally. CI publishes.

## Checks

Run `npm run build`, `npm run typecheck` and `npm test` before you finish. CI runs the same steps. It does not run Playwright e2e.
