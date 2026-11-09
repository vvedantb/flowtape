#!/usr/bin/env bash
# Create the vX.Y.Z tag and GitHub release for a published @vvedantb/flowtape.
# Run after `changeset publish`. Needs GH_TOKEN and the gh CLI.
# Usage: scripts/github-release.sh [version]   (default: version in package.json)
set -euo pipefail

PKG_DIR="packages/flowtape"
VERSION="${1:-$(node -p "require('./${PKG_DIR}/package.json').version")}"
TAG="v${VERSION}"
TARGET="${GITHUB_SHA:-$(git rev-parse HEAD)}"

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "GitHub release ${TAG} already exists. Nothing to do."
  exit 0
fi

# Take the "## X.Y.Z" section from the changelog, without the heading.
NOTES="$(awk -v v="$VERSION" '
  $0 == "## " v { found = 1; next }
  found && /^## / { exit }
  found { print }
' "${PKG_DIR}/CHANGELOG.md")"

if [ -z "$(printf '%s' "$NOTES" | tr -d '[:space:]')" ]; then
  echo "No changelog section for ${VERSION}. Using a default note." >&2
  NOTES="Release ${TAG}."
fi

# --target makes gh create the tag on the release commit if it is missing.
printf '%s\n' "$NOTES" | gh release create "$TAG" \
  --title "$TAG" \
  --target "$TARGET" \
  --verify-tag=false \
  --notes-file -
echo "Created GitHub release ${TAG} at ${TARGET}."
