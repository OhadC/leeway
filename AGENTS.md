# leeway

Per-folder dev port ranges. `packages/leeway` is the library + CLI; `examples/playground` dogfoods the vite plugin by hand.

## Commands

- Done means `pnpm verify` is green (typecheck + lint + tests once, real exit code), plus `pnpm test:linux` when touching `process-tree.ts`, `listener-scan.ts`, `range-kill.ts` or `run-with-ports.ts`.
- `pnpm lint` is oxlint + knip (unused exports, files, deps) + `scripts/check-terms.ts`.
- Tests never need `pnpm build`: integration tests run `node src/cli.ts`.
- Formatting runs on commit (oxfmt on staged files); CI checks it. Leave repo-wide `pnpm format` alone.

## Coding standards

Before writing, editing or reviewing code, read [CODING_STANDARDS.md](CODING_STANDARDS.md).

## Navigating TS symbols

Use LSP, not grep: `ToolSearch select:LSP`, then `workspaceSymbol` with the symbol name and `filePath` = an existing `.ts` file, then position ops (`goToDefinition`, `findReferences`, `incomingCalls`, `hover`, `documentSymbol`).

## Agent skills

- Issue tracker: local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.
- Triage labels: the default five. See `docs/agents/triage-labels.md`.
- Domain docs: single-context, `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
