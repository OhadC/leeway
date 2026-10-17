# leeway

Per-folder dev port ranges. `packages/leeway` is the library + CLI; `examples/playground` dogfoods the vite plugin by hand.

## Commands

- `pnpm test` - vitest in `packages/leeway` (add `-- --run` for a single run)
- `pnpm typecheck` - tsc across the workspace
- `pnpm lint` - oxlint + oxfmt check; `pnpm format` to fix
- `pnpm build` - tsdown (tests never need it: integration tests run `node src/cli.ts`)

## Conventions

- No code comments, including doc comments.
- Specific export names: `LeewayRegistry.claim`, not `claim`; `CatalogueFile.find`, not `find`. No generic `parse`, `getKey`, `utils`.
- Prefer one static class per concept over scattered helper functions.
- Order inside a module: public members first, private members next, module-level helpers at the bottom.
- Tests must be able to go red on a real bug. No tautological tests (asserting a mock returns what it was told to, or restating the implementation).
- Keep it simple, YAGNI. No speculative options or abstractions.
- No "slot" wording anywhere; the concepts are catalogue, range, registry, default ports.
- Relative imports use the `.ts` extension; TypeScript is erasable-syntax only (no enums, namespaces, parameter properties).
- OS-dependent code takes injected runners/adapters so its parsing and decisions are unit-tested on any OS.

## Navigating TS symbols

Use LSP, not grep: `ToolSearch select:LSP`, then `workspaceSymbol` with the symbol name and `filePath` = an existing `.ts` file, then position ops (`goToDefinition`, `findReferences`, `incomingCalls`, `hover`, `documentSymbol`).
