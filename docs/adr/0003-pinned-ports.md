# 0003: Pinned ports

## Status

Accepted, 2026-11-10. Adds to [0001](0001-leeway.md); the config and catalogue rules there still hold.

## Context

Some ports a dev setup uses should not move per folder: a local Postgres, or another repo's dev server, that every folder uses at once
and nobody wants to start again per worktree. Left out of `leeway.json`, such a port is hardcoded or kept in a separate `.env`, so the
repo loses its one file of ports and the one `devPorts` call that reads them, and non-JS tools lose `{{NAME}}` and the environment.

## Decision

**A separate section.** The config gains `pinned` beside `ports`: `{ "pinned": { "NAME": { "port": <port>, ...any props } } }`, the same
entry shape as the catalogue. A name in both sections is refused, and `LEEWAY_ENV` and `LEEWAY_FOLDER` are reserved in both, as in the catalogue.

**Resolved like every port, never ranged.** `devPorts` returns catalogue and pinned ports alike, each from its environment variable, else
the config. The CLI hands pinned ports down in every mode, through the environment, `{{NAME}}`, `{{LEEWAY_ENV}}` and `env --export`, and
marks them `pinned` in its table. The vite plugin's `port` and `preview` may name one. Nothing else sees them: a range is as wide as the
catalogue alone, the registry never records them, the port test never binds them, the agent guard reads only the catalogue, and `list` and
`kill` never reach them, since they sit outside every range.

**Refused inside a pool.** A claim fails when a pinned port lies inside one of the machine's pools: there, every repo's `list` would show
its listener as an orphan, `kill --orphans` would kill it, and another folder could claim it while it is down. `--default` reads no pools
and doesn't check.

**No switch per run.** A folder that needs its own copy moves the entry into `ports`, uncommitted; its next claim grows the range by one,
trying the current start first.

## Considered options

- **A `pinned: true` prop on a catalogue entry.** One map, and flipping is one word. Rejected: a pinned port isn't part of the per-folder
  catalogue, and props besides `port` were promised to the user, so an older leeway would silently range the port instead of refusing a
  config it can't read.
- **`--unpin <NAME>`, keeping a range port for every pinned entry.** Flipping a run would be free and never move the range. Rejected: it
  pulls pinned ports back into claims and range width for a case an uncommitted edit already covers.
- **A third state for ports leeway must never kill.** Rejected: a pinned port outside every pool is already out of `kill`'s reach, and
  refusing pinned ports inside a pool keeps it so.
- **Naming another folder's port** instead of a number. Out of scope here; a separate design.
