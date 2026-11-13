# Contributing

## Development

```sh
pnpm install
pnpm verify        # typecheck + lint + tests, once
pnpm test          # vitest in watch mode
pnpm test:linux    # the same suite in a Linux container (podman)
pnpm test:package  # build, pack and install the package, then use it as a consumer would
pnpm build
```

Formatting runs on commit through a pre-commit hook; CI checks it.

## Releasing

1. Open a PR that bumps `packages/leeway/package.json`. Its body is the release notes: what's new, fixes, docs, grouped for users,
   ending with the full changelog link. Leave out internal changes (tests, CI, refactors).
2. Merge it, then tag the merge commit `v<version>` and push the tag. `release.yml` runs CI, publishes to npm and creates the GitHub
   release from the PR's body, or from generated notes when the body is empty.
