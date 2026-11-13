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
