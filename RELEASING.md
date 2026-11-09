# Releasing

Only `@vvedantb/flowtape` is published. Releases use Changesets and run from `.github/workflows/release.yml`.

## Add a changeset

Run this for every user-facing change, then commit the new file in `.changeset/` with your PR:

```bash
npm run changeset
```

Pick `@vvedantb/flowtape`, choose the bump (patch, minor or major) and write a short summary. The summary becomes the changelog entry. Changes with no user impact (docs, CI, demos, site) need no changeset.

## Version Packages PR flow

1. A PR with a changeset merges to `main`.
2. The release workflow opens or updates a "Version Packages" PR. It bumps the version and writes `CHANGELOG.md`.
3. A maintainer reviews and merges that PR. No changesets are left at that point.
4. The workflow builds, tests and runs `changeset publish`. This publishes to npm with provenance. Changesets also creates an `@vvedantb/flowtape@X.Y.Z` tag, which is safe to ignore.
5. When the publish succeeds, `scripts/github-release.sh` creates the `vX.Y.Z` tag on the release commit and a GitHub release with the new `packages/flowtape/CHANGELOG.md` section as notes. Changesets does not create these itself (`createGithubReleases` is off). The script skips a release that already exists, so a re-run is safe.

## Tag convention

Use `vX.Y.Z` (for example `v0.4.1`) for tags and GitHub releases. Do not use the `@vvedantb/flowtape@X.Y.Z` form for releases.

## Trusted publishing (no token needed)

Publishing uses npm Trusted Publishing (OIDC). The workflow needs `id-token: write` and npm 11.5.1 or later (the job upgrades npm).

One-time setup on npmjs.com, in the package settings for `@vvedantb/flowtape`: add a trusted publisher with owner `vvedantb`, repository `flowtape`, workflow `release.yml`.

No `NPM_TOKEN` is required. If the repository secret `NPM_TOKEN` is set, the workflow passes it as a fallback. Leave it unset to use OIDC.

## Dry run

Run the workflow from the Actions tab (Release, "Run workflow") with `dry_run` ticked. It installs, builds, tests, prints `changeset status` and runs `npm publish --dry-run`. It publishes nothing.

## Version and tag mismatch

At the time of writing, npm `latest` is 0.5.1 and the latest GitHub release is v0.4.1. Releases between them were published without tags or GitHub releases. Changesets only tags new versions, so the gap stays until backfilled. To backfill, tag the commit for each published version and create the release by hand:

```bash
git tag v0.5.1 <commit-that-published-0.5.1>
git push origin v0.5.1
gh release create v0.5.1 --title v0.5.1 --notes "<notes>"
```

Do this for each missing version, oldest first. Check the commit against the version in `packages/flowtape/package.json` at that commit.
