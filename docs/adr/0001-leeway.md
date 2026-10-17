# 0001: Per-folder dev port ranges

## Status

Accepted, 2026-10-17. leeway is extracted from the in-repo `dev-ports` tool; this records its design under the new names.

## Context

Several agents work in parallel git worktrees of one repository while the developer works in another. Every dev server, mock server and
preview server bound a hardcoded port, so the second dev server on the machine failed with `EADDRINUSE`, or worse, vite moved to port+1 and
tests in one worktree talked to a server of another. Nobody could say which folder was listening on which port without `netstat`
archaeology, and the developer lost the usual ports whenever an agent needed a dev server. More than one repository on the machine has the
problem, each with a different number of ports.

Alternatives considered:

- **worktrunk** - a worktree manager that also assigns ports. It owns worktree creation, which is better left to other tools, and has no
  native Windows port-to-process listing.
- **portless, `get-port`, `kill-port`** - pick a free port at start-up. A free port is not a predictable one: bookmarks, `launch.json` and
  test preflights need the URL before the server exists, and a listing would have nothing stable to report.
- **Hash of the folder path to a port block** - stateless, but two folders whose hashes collide get the same ports, which is the
  `EADDRINUSE` this exists to remove.
- **A port file inside each folder** - committed it is wrong for everyone else, gitignored it is lost on a fresh clone, and no single place
  knows which ports are taken.
- **Fixed-width blocks computed from a number** (the first `dev-ports` design) - a fixed block wastes ports for small repos, caps large ones,
  and a catalogue longer than the block spills silently into the next block. One repo also can't name another repo's ports.

## Decision

**Catalogue.** Each repo declares its ports in one `leeway.json`: `{ "NAME": { "port": <default port>, ...any props } }`. The key is the
environment variable the port travels in, `port` is the default port. The catalogue is found by walking up from the current directory, and
the nearest wins; the folder holding it owns the range, so every worktree, or a sub-package with its own `leeway.json`, claims separately.
Every consumer resolves `env[NAME] ?? default` through `devPorts(catalogue)`; no literal port is left in configs.

**Ranges in a machine-wide registry.** A folder's range is recorded in `~/.leeway/ranges.json`: a format `version` and a map from absolute
folder path (lowercased on Windows) to `{ start, end, ports }`, with `ports` naming each port. A range is exactly as wide as its catalogue,
and any tool can list and kill any repo's ports by reading entries, never by computing them. The registry is global rather than per-repo so
every repo shares one allocator and one listing.

**Pool 21000-29999.** All ranges come from this pool, so "is this port leeway's?" is a range check. It is above the low ports products use
and clear of the earlier `dev-ports` layouts (20020-21999), so old and new tooling run side by side. It is not configurable.

**Claiming.** Under a lock, a claim drops entries whose folder is gone, tries the folder's current start first, so a repeat claim keeps its
range and a grown catalogue stays put when the next ports are free, then every gap from low to high. It takes the first candidate that
overlaps no living entry and whose ports all pass the port test. When the range moves, the CLI warns on stderr.

**Port test.** It binds `127.0.0.1`, `::1`, `0.0.0.0` and `::`, because on Windows a wildcard bind succeeds while something listens on a
loopback address (vite on `::1`). A missing address family is skipped. The result is free, in-use or unavailable (reserved, access
denied). A folder's own in-use ports pass, since they are its running servers; an unavailable port moves the range, so a port the OS
reserved since the last run relocates the range instead of failing the server.

**Lock and writes.** The lock is a directory next to the registry holding one file named by its holder's random token, taken by renaming a
prepared directory into place so it is never seen empty while held. Waiters retry; a token older than ten seconds is deleted so a crash
never blocks later claims, and the directory is only removed while empty, so breaking a stale lock or a late release never removes another
claim's lock. The registry is written atomically (temp file, rename).

**Unknown data.** Entries the code doesn't understand are passed through untouched and don't occupy a range, so one leeway version never
erases another's claims. A registry with a newer `version` refuses claims ("update leeway"); one that isn't a registry refuses claims rather
than being overwritten.

**Default ports are each repo's own business.** `leeway exec --defaults` runs on the catalogue's ports without touching the registry; they
may collide across repos. Plain `leeway exec` uses the environment, else default ports, so one script works both in a shell that already has
its range and in a developer's shell that wants the usual ports. `--claim` claims the range. `{{NAME}}` in the command becomes the port, for
tools that take a port only as an argument.

**Environment variables are the transport.** They pass through `concurrently`, `tsx`, package scripts and shells to every child process
with no integration. `leeway exec` runs the command through the system shell: one argument is a shell line, several are an argv quoted for
the shell. Stopping leeway stops the tree: on POSIX the command gets its own process group and SIGINT, SIGTERM and SIGHUP are forwarded to
it; on Windows, which has no process groups to signal, Ctrl+C, Ctrl+Break and console close run `taskkill /T /F`.

**Browser and vite.** `devPorts` is browser-safe. `leeway/vite` sets `server.port` and `preview.port` with `strictPort`, so a taken port
fails instead of drifting, and on `serve` defines `__LEEWAY_ENV__` so browser code sees the server's ports. Builds keep default ports unless
`alwaysInject` is set, so dev ports never leak into a production bundle.

**Agents.** Agents forget rules, so leeway makes forgetting loud. `devPorts` throws in an agent shell (`CLAUDECODE`, `GEMINI_CLI`,
`CURSOR_AGENT`, `AI_AGENT`) when none of the catalogue's variables are set, except under `VITEST`, where app modules read ports at import
time. Claude Code gets its range up front: a SessionStart hook appends `leeway env --export` to `$CLAUDE_ENV_FILE`, which is sourced before
every Bash command. Claude Code's PowerShell tool honours that file only when every line is a plain export, so `leeway env --export` writes only `export NAME=port` lines to stdout and everything else to
stderr. The earlier `dev-ports` rewrote every `pnpm <script>` in a PreToolUse hook; exporting the range once per session covers every command,
not just package scripts. Other agents are
told to run `leeway exec --claim -- <command>`. Codex has no reliable marker, and Copilot and Aider document none, so for them the guard
can't fire.

**Listing and killing scan the OS.** `leeway list` shows every range from every repo with the pid on each port, plus orphans: pool listeners
outside every living range. A registry-only listing can't tell a running server from a dead registration, which is most of the question.
`leeway kill [<port>]` kills the listeners in this folder's range or in the range holding the port. The scan uses PowerShell's
`Get-NetTCPConnection` on Windows, `ss` on Linux and `lsof` on macOS, behind an injected command runner so parsing is tested on any OS.

**Rejected scope.** No `leeway init`: the catalogue is a few lines written by hand. No configurable pool. No pool compaction.

## Consequences

- One folder means one range whoever starts the server, and any number of folders and repos run at once; cross-service URLs follow the
  range they belong to.
- A small repo reserves only the ports it has, and no catalogue spills into another range.
- Adding a server is one catalogue entry.
- A freed range whose orphaned servers still listen, or a port held by an unrelated process or reserved by the OS, is skipped at claim time.
- A port can still be taken between the claim and the server binding it; `strictPort` and bind errors make that loud.
- The pool is never compacted and can fragment; a full pool fails with a message to remove unused folders' ranges.
- A hard kill of `leeway exec` itself skips its cleanup and can orphan the command tree on any OS; `leeway kill` recovers it.
- Anything spawned with a scrubbed environment loses its ports, and in an agent shell hits the guard.
- Reading a vite config no longer shows the port.
