# leeway

Per-folder dev port ranges. `packages/leeway` is the library + CLI; `examples/playground` dogfoods the vite plugin by hand.

## Commands

- `pnpm verify` - typecheck + lint + tests once, real exit code; use it instead of chaining steps by hand
- `pnpm test` - vitest in `packages/leeway` (add `--run` for a single run)
- `pnpm typecheck` - tsc across the workspace
- `pnpm lint` - oxlint + knip (unused exports, files, deps) + `scripts/check-terms.ts` (GLOSSARY.md _Avoid_ terms)
- Formatting runs on commit: the pre-commit hook formats staged files with oxfmt. Don't run repo-wide `pnpm format`; CI checks formatting.
- `pnpm build` - tsdown (tests never need it: integration tests run `node src/cli.ts`)
- Done means `pnpm verify` is green, plus `pnpm test:linux` when touching `process-tree.ts`, `listener-scan.ts`, `range-kill.ts` or `run-with-ports.ts`.

## Conventions

- No code comments, including doc comments.
- Specific export names: `RangeRegistry.claim`, not `claim`; `ConfigFile.find`, not `find`. No generic `parse`, `getKey`, `utils`.
- Prefer one static class per concept over scattered helper functions.
- Order inside a module: public members first, private members next, module-level helpers at the bottom.
- Tests must be able to go red on a real bug. No tautological tests (asserting a mock returns what it was told to, or restating the implementation).
- Keep it simple, YAGNI. No speculative options or abstractions.
- Use `GLOSSARY.md` terms everywhere; `pnpm lint` fails on its _Avoid_ words.
- Relative imports use the `.ts` extension; TypeScript is erasable-syntax only (no enums, namespaces, parameter properties).
- Parsing OS command output takes an injected command runner so it is unit-tested on any OS. Spawning, signalling and killing real processes is not faked: it is covered by real-process tests on each OS (Windows locally, linux via `pnpm test:linux`, mac in CI).

## Navigating TS symbols

Use LSP, not grep: `ToolSearch select:LSP`, then `workspaceSymbol` with the symbol name and `filePath` = an existing `.ts` file, then position ops (`goToDefinition`, `findReferences`, `incomingCalls`, `hover`, `documentSymbol`).

## Agent skills

### Issue tracker

GitHub Issues on `OhadC/leeway` via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
