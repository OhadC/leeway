# leeway

Per-folder dev port ranges. `packages/leeway` is the library + CLI; `examples/playground` dogfoods the vite plugin by hand.

## Commands

- `pnpm test` - vitest in `packages/leeway` (add `-- --run` for a single run)
- `pnpm typecheck` - tsc across the workspace
- `pnpm lint` - oxlint + oxfmt check; `pnpm format` to fix
- `pnpm build` - tsdown (tests never need it: integration tests run `node src/cli.ts`)

## Conventions

- No code comments, including doc comments.
- Specific export names: `RangeRegistry.claim`, not `claim`; `ConfigFile.find`, not `find`. No generic `parse`, `getKey`, `utils`.
- Prefer one static class per concept over scattered helper functions.
- Order inside a module: public members first, private members next, module-level helpers at the bottom.
- Tests must be able to go red on a real bug. No tautological tests (asserting a mock returns what it was told to, or restating the implementation).
- Keep it simple, YAGNI. No speculative options or abstractions.
- No "slot" wording anywhere; the concepts are config, catalogue, range, registry, default ports.
- Relative imports use the `.ts` extension; TypeScript is erasable-syntax only (no enums, namespaces, parameter properties).
- Parsing OS command output takes an injected command runner so it is unit-tested on any OS. Spawning, signalling and killing real processes is not faked: it is covered by real-process tests on each OS (Windows locally, linux via `pnpm test:linux`, mac in CI).

## Navigating TS symbols

Use LSP, not grep: `ToolSearch select:LSP`, then `workspaceSymbol` with the symbol name and `filePath` = an existing `.ts` file, then position ops (`goToDefinition`, `findReferences`, `incomingCalls`, `hover`, `documentSymbol`).

## Agent skills

### Issue tracker

Local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
