# 0002: Forward-compatible registry

## Status

Accepted, 2026-10-23, from leeway 0.3. The "Unknown data" paragraph of [0001](0001-leeway.md) points here for the full contract.

## Context

Every repo pins its own leeway, and the machine's owner can't upgrade every repo that uses it, especially third-party ones. All of them
share one registry. Up to 0.2.0, reading it was strict: a newer `version` refused claims ("update leeway"), a write dropped top-level keys
it didn't know, and an entry with an extra key, or outside 21000-29999, was ignored and held no ports. So any future change to the
registry would either block every older leeway on the machine, or let it claim over newer data and erase it. Upgrading leeway in one repo
must never force an upgrade in another.

## Decision

From 0.3 on, the registry is forward-compatible, and stays so.

- **`version`.** A new registry is written with `version: 1`, and an existing value is kept as found. No reader gates on it; the field
  stays only because 0.2.0 checks it.
- **Unknown data is kept.** Every write keeps the top-level keys and entry keys it doesn't understand. When a claim rewrites the
  folder's own entry, it updates `start`, `end` and `ports` and keeps the entry's other keys.
- **Every readable range holds its ports.** An entry holds `start`-`end` when both are integers 1-65535 with `start` ≤ `end`, whatever
  else it holds and wherever it sits. `ports` is read when every value is a port inside the range, for keeping a range and for listing;
  otherwise the range is listed without its ports. Any other entry is passed through untouched and holds nothing.
- **Listing and killing.** Living ranges are listed and killable wherever they sit, and `kill <port>` resolves a port in any of them.
  Orphans and the orphan-port kill stay in the default pool, so unrelated tools on common ports are never treated as leeway's;
  `kill <port>` refuses a port outside every living range and outside the default pool. A claim still places ranges only in a pool.
- **Refusal.** Only a registry that isn't a JSON object with an object `folders` refuses claims.
- **Frozen.** The registry path, the lock protocol, the meaning of every existing key, the environment handed down between nested calls
  (`LEEWAY_FOLDER` and the port variables), and the `{{NAME}}` and `{{LEEWAY_ENV}}` placeholders. Existing keys are never removed,
  retyped or given a new meaning. New behaviour comes only through new keys or files, and an older leeway that ignores them must stay
  safe.

Every future change to the registry is checked against this contract: it adds data that older versions ignore safely, never data that
blocks them.

**The 0.2.0 exception.** 0.3 is the last change that may break an older leeway, and only 0.2.0. `version` stays 1, so 0.2.0 keeps
claiming. It rewrites the registry as `{ version, folders }`, dropping newer top-level keys, and ignores entries with extra keys or outside
21000-29999, so it could claim over them. Both are accepted while leeway is pre-release.

## Consequences

- Repos on any leeway from 0.3 on claim side by side, whichever upgrades first, and a nested `leeway` of another version follows its
  outer call's ports as before.
- A new feature degrades in an older leeway instead of blocking it: its data survives the older leeway's claims, and its ranges are never
  claimed over.
- `version` carries no meaning: there is no breaking change left for it to signal.
- A hand-edited or corrupt entry with a readable range holds its ports until it is fixed or deleted.
- Protecting newer data from 0.2.0 is out of scope.
