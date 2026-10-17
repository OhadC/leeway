# leeway

Per-folder dev port ranges, so parallel worktrees and AI agents never fight over ports.

- [packages/leeway](packages/leeway/README.md): the library and CLI, published to npm as `leeway`
- [examples/playground](examples/playground): a vite app and an api server wired through leeway, for trying it by hand
- [docs/adr](docs/adr): design decisions

## Development

```sh
pnpm install
pnpm test          # vitest in packages/leeway (add -- --run for a single run)
pnpm test:linux    # the same suite in a Linux container (podman)
pnpm typecheck
pnpm lint          # oxlint + oxfmt check; pnpm format to fix
pnpm build
```
