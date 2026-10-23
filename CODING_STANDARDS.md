# Coding Standards

The rules a human or an agent holds while writing and reviewing code here. Each rule's essence lives here; reasoning that needs more than a short paragraph goes to `docs/adr/` with a link.

## TypeScript

### Specific export names

An exported name describes the specific thing it is, because the import site sees it without its module: `RangeRegistry.claim`, not `claim`; `ConfigFile.find`, not `find`. Generic names like `parse`, `getKey` or `utils` say nothing there.

### One static class per concept

Functions that share a prefix or work on the same data become static members of one class: one import, one named namespace, one place to grow.

```typescript
// ❌ scattered helpers
export function scanListeners() { ... }
export function parseNetstat(output: string) { ... }

// ✅ one static class
export class ListenerScan {
    static listeners() { ... }
    private static windowsListeners(output: string) { ... }
}
```

### Public first, helpers last

Order a module by how a reader arrives: exported and public members first, private members next, module-level helper functions at the bottom.

### Code that explains itself

Rename or extract until the code reads plainly. The code carries no comments, doc comments included.

### Glossary terms

Name things with `GLOSSARY.md` terms, in code and prose alike. `pnpm lint` fails on its _Avoid_ words.

### `.ts` imports

Relative imports carry the `.ts` extension.

### YAGNI

Build for the case in front of you: every option and abstraction has a caller today.

## Tests

### Tautological tests considered harmful

A test must be able to go _red_ on a real bug. Assert observable behaviour through the public interface, not a restatement of the implementation or a mock echoing its setup.

### The OS is the only boundary

Code that parses OS command output takes an injected `CommandRunner`, so its parsing is unit-tested on any OS. Spawning, signalling and killing real processes runs for real: real-process tests on each OS (Windows locally, linux via `pnpm test:linux`, mac in CI). Everything inside the boundary goes in real.
