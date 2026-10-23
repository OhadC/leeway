# leeway

[![npm](https://img.shields.io/npm/v/leeway)](https://www.npmjs.com/package/leeway)
[![ci](https://github.com/OhadC/leeway/actions/workflows/ci.yml/badge.svg)](https://github.com/OhadC/leeway/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/OhadC/leeway)](https://github.com/OhadC/leeway/blob/main/LICENSE)

Per-folder dev port ranges, so parallel worktrees and AI agents never fight over ports.

Two checkouts of the same repo both want port 5173. One fails with `EADDRINUSE`, or vite quietly moves to 5174 and the other worktree's
tests talk to the wrong server. leeway gives every folder its own stable, contiguous range of ports and hands them to your servers as
environment variables.

```sh
$ leeway vite
leeway: ports 21000-21001 for /home/me/app
  PORT_WEB  21000
  PORT_API  21001
```

The worktree next door gets 21002-21003, and it keeps that range on every run.

## Install

```sh
npm install -D leeway
```

Requires Node >= 22.18. `leeway/vite` needs vite >= 7.

## The config: `leeway.json`

One `leeway.json` at the top of the repo. Its `ports`, the catalogue, list every port your dev setup uses: the key is the environment variable
(letters, digits and `_`, not starting with a digit), `port` is its default port. Any other properties of an entry are yours; leeway
ignores them.

```json
{
    "$schema": "./node_modules/leeway/schema.json",
    "ports": {
        "PORT_WEB": { "port": 5173 },
        "PORT_API": { "port": 3001, "description": "mock api" }
    },
    "agentGuard": true
}
```

| setting      | default | meaning                                                                |
| ------------ | ------- | ---------------------------------------------------------------------- |
| `ports`      | -       | the catalogue; required                                                |
| `agentGuard` | `false` | refuse default ports to agent shells (see [Agent guard](#agent-guard)) |

Unknown settings are refused, so a typo fails loudly.

leeway finds the config by walking up from the current directory; the nearest `leeway.json` wins, and the folder holding it is the
folder that owns the range. Commit it: every worktree gets its own copy and therefore its own range.

## Ranges and the registry

A folder's range is claimed from the machine's pools, the default pool 21000-29999 unless the machine's owner set others with
[`leeway pools`](#leeway-pools-set-start-end--reset), and recorded in the machine-wide registry `~/.leeway/ranges.json`, shared by every
repo on the machine:

```json
{
    "version": 1,
    "folders": {
        "/home/me/app": { "start": 21000, "end": 21001, "ports": { "PORT_WEB": 21000, "PORT_API": 21001 } },
        "/home/me/app-feature": { "start": 21002, "end": 21003, "ports": { "PORT_WEB": 21002, "PORT_API": 21003 } }
    }
}
```

- A range is exactly as wide as the catalogue; ports follow the catalogue's order.
- A claim keeps the folder's current range whenever it sits inside one pool and its ports are still free (or held by the folder's own
  running servers). Otherwise it takes the first gap, pools in the order they were set and each pool from low to high, that overlaps no
  other range and whose ports can all be bound, and warns that the range moved. A range never spans two pools.
- Ports held by something else, or reserved by the OS, are skipped at claim time.
- Ranges of folders that no longer exist are dropped the next time a claim has to place a range.
- Claims are serialised by a lock next to the registry, so concurrent `leeway` runs never get the same range.
- Repos on different leeway versions share the registry: from 0.3 on, no version refuses it, a claim keeps data it doesn't understand,
  and every readable range holds its ports.

Default ports never touch the registry.

## In code: `devPorts`

```ts
import { devPorts } from "leeway";
import config from "./leeway.json" with { type: "json" };

const { PORT_API } = devPorts(config);

server.listen(PORT_API);
```

`devPorts(config)` returns one port per catalogue entry: the entry's environment variable if it is set to a port, else the default
port. It is browser-safe: in the browser it reads the ports injected as `LEEWAY_ENV`, by the vite plugin or by `{{LEEWAY_ENV}}`
(see [Other bundlers](#other-bundlers)), and falls back to default ports when there are none.

### Agent guard

With `"agentGuard": true`, `devPorts` throws in an agent shell (`CLAUDECODE`, `GEMINI_CLI`, `CURSOR_AGENT` or `AI_AGENT` set) when none
of the catalogue's variables are set, so an agent can't silently start a server on your default ports. It is off by default. It is skipped
under `VITEST`, because app modules often read ports at import time in tests. Codex sets no reliable marker, and Copilot and Aider document
none, so for them the guard can't fire; tell them to start servers through `leeway` (see [Agents](#agents)).

## Vite: `leeway/vite`

```ts
import { leeway } from "leeway/vite";
import { defineConfig } from "vite";
import config from "./leeway.json" with { type: "json" };

export default defineConfig({
    plugins: [leeway({ config, port: "PORT_WEB" })],
});
```

Passing the config types `port` and `preview` against its port names. Without it, the plugin finds `leeway.json` from vite's `root`:

```ts
leeway({ port: "PORT_WEB" });
```

The plugin:

- sets `server.port` and `preview.port` from `devPorts`, with `strictPort: true`, so a taken port fails loudly instead of drifting to
  port+1. `vite preview` uses the `port` name too; name another with `preview` for an app that runs its preview beside its dev server
  (`leeway({ config, port: "PORT_WEB", preview: "PORT_PREVIEW" })`);
- on `vite serve`, defines `LEEWAY_ENV` with every catalogue port, so `devPorts(config)` in browser code sees the same ports as the
  server. Builds keep default ports unless you pass `alwaysInject: true`.

## Other bundlers

A bundler with a define option gets the same browser ports from the `{{LEEWAY_ENV}}` placeholder, which becomes every catalogue port as
JSON. Angular CLI, for example:

```json
{
    "scripts": {
        "serve": "leeway ng serve --port {{PORT_WEB}} --define LEEWAY_ENV={{LEEWAY_ENV}}"
    }
}
```

## CLI

### `leeway [--default | --inherit] [--] <command>`

Runs `<command>` with every catalogue port in its environment.

| mode        | ports                                                                                 |
| ----------- | ------------------------------------------------------------------------------------- |
| (no flag)   | this folder's range, claimed in the registry, whatever the environment already has    |
| `--default` | default ports, ignoring the environment and the agent guard                           |
| `--inherit` | `devPorts`: the ports in the environment, else default ports; the agent guard applies |

`--inherit` is for scripts that are run by others: started under `leeway` they follow its ports, claimed or default, and on their own
they get default ports. Neither touches the registry. The no-flag and `--default` modes print the port table on stderr, once per
tree (see below).

A nested call is decided by the outermost one. `leeway` hands its folder down in `LEEWAY_FOLDER` with the ports, and a no-flag call
for the same folder under it runs on the ports it was handed, without claiming again or printing a second table. So in
`leeway --default concurrently "pnpm dev" ...`, where `dev` is `leeway vite`, vite gets the default ports. A no-flag call for another
folder still claims its own range, and an explicit `--default` or `--inherit` keeps its meaning at any depth.

```json
{
    "scripts": {
        "dev": "leeway vite",
        "dev:default": "leeway --default vite",
        "wait:api": "leeway --inherit wait-on tcp:{{PORT_API}}"
    }
}
```

- `{{NAME}}` anywhere in the command becomes that port. A `{{NAME}}` that is not in the catalogue fails before anything is claimed or run.
- `{{LEEWAY_ENV}}` becomes every catalogue port as JSON, `{"PORT_WEB":21000,"PORT_API":21001}`, so `LEEWAY_ENV` can't be a port name.
  It needs the command as several arguments, which leeway quotes; in a one-argument shell line it fails.
- `env`, `list`, `kill` and `pools` are leeway's own commands, and a flag before the command is leeway's: an unknown one fails with the usage. To
  run a command with one of those names, or starting with `-`, put `--` first: `leeway -- kill ...`.
- One argument is a shell line, run as-is: `leeway "vite build && vite preview"`. Several arguments are an argv: each is quoted for the
  shell when needed, so `leeway node -e "console.log(1)"` runs exactly that. On Windows a `.cmd` shim re-parses its arguments, so an
  argument holding both `"` and a cmd metacharacter like `&` can still break there.
- The command runs through the system shell (`sh`, `cmd.exe` on Windows).
- leeway exits with the command's exit code, or 1 if it died from a signal or could not start.
- Stopping leeway stops the whole command tree. On Linux and macOS the command runs in its own process group and SIGINT, SIGTERM and SIGHUP
  are forwarded to the group. On Windows, Ctrl+C, Ctrl+Break or closing the console kills the tree with `taskkill /T /F`.

`leeway --help` (or `-h`) prints the usage, `leeway --version` the version.

### `leeway env --export`

Claims this folder's range and prints it as shell export lines:

```sh
$ leeway env --export
export PORT_WEB=21000
export PORT_API=21001
```

stdout carries only `export NAME=port` lines; the port table and warnings go to stderr. If the range moved since the last claim, stderr
says so: restart anything still on the old ports. Use it as `eval "$(leeway env --export)"` to give a shell its range, after which
`devPorts` and tools started without `leeway` pick the ports up.

### `leeway list [--json]`

Every registered range on the machine, from every repo, with the pid listening on each port, followed by orphans: listeners in the
default pool outside every range (for example a server left behind by a deleted worktree).

```text
/home/me/app  21000-21001
  PORT_WEB  21000  pid 4120
  PORT_API  21001  -

orphans (in the pool, outside every range)
  21007  pid 5532
```

`--json` prints the same as JSON, for tools; read this rather than the registry, which may list deleted folders:

```json
{
    "ranges": [
        {
            "folder": "/home/me/app",
            "start": 21000,
            "end": 21001,
            "ports": [
                { "name": "PORT_WEB", "port": 21000, "pids": [4120] },
                { "name": "PORT_API", "port": 21001, "pids": [] }
            ]
        }
    ],
    "orphans": [{ "port": 21007, "pid": 5532 }]
}
```

`folder` is lowercased on Windows.

### `leeway kill [<port>]`

Kills every process tree listening in this folder's range, or with a port, in the range that contains it (any repo's). A listener started
under `leeway` is killed with the nearest `leeway` run above it and that run's whole tree, so a watcher between them (`tsx watch`,
`nodemon`) can't restart it; that takes down whatever else the run started too, like a `tsc --watch` beside the server under the same
`concurrently`. A default-pool port outside every range is an orphan: `leeway kill <port>` kills just the listeners on that port, never
their run. Ports outside every range and outside the default pool are refused.

### `leeway pools [set <start-end>... | reset]`

The machine's pools, the blocks of ports every repo's ranges come from. For machines where 21000-29999 is a poor fit, for example when a
firewall allows only certain ports or ports are forwarded into a container or VM. Pools apply to leeway 0.3 and later; older versions
ignore them and keep claiming in 21000-29999.

```sh
$ leeway pools
21000-29999 (the default pool)
$ leeway pools set 3000-3999 21000-29999
3000-3999
21000-29999
$ leeway pools reset
21000-29999 (the default pool)
```

- `leeway pools` prints the pools in the order they were set, or the default pool when none are.
- `leeway pools set` replaces the pools, in order of preference. Each pool is written `start-end`, like leeway prints ranges. Ports must be
  integers 1-65535 and a start can't be above its end; no pools, or pools that overlap, are refused too, and nothing is written. Adjacent
  pools are fine and stay separate.
- `leeway pools reset` goes back to the default pool.
- Neither moves any range. A range outside the new pools keeps holding its ports until its folder claims again, which moves it into a pool
  with the usual warning.
- The pools are stored as `pools` beside `folders` in `~/.leeway/ranges.json`. A hand edit leeway can't read makes claims and
  `leeway pools` fail until you fix it, for example with `leeway pools set` or `leeway pools reset`.

## Agents

**Claude Code**: give every session its range up front with a SessionStart hook in `.claude/settings.json`. Claude Code sources
`$CLAUDE_ENV_FILE` before each Bash command, so every server the agent starts sees the ports, even one started without `leeway`:

```json
{
    "hooks": {
        "SessionStart": [
            {
                "hooks": [{ "type": "command", "command": "npx leeway env --export >> \"$CLAUDE_ENV_FILE\"" }]
            }
        ]
    }
}
```

This is why `leeway env --export` prints nothing but plain `export NAME=port` lines on stdout: Claude Code's PowerShell tool honours
`$CLAUDE_ENV_FILE` only when every line is a plain export, and in Bash a table or a warning there would run as a command.

**Other agents** (Codex, Gemini CLI, Cursor, Copilot, Aider, ...): tell them in `AGENTS.md` to start servers with
`leeway <command>`. Where the agent sets a marker, turning on the agent guard catches the times it forgets.

## Limits

- A hard kill of `leeway` itself (SIGKILL, Task Manager, `taskkill /F` on leeway alone) skips its cleanup and can leave the command
  tree running. Recover with `leeway kill` in that folder.
- On Windows, a command that exits while leaving background grandchildren behind can leave them running too; `leeway kill` again.
- On Linux and macOS the command runs in its own session (that is how it gets its own process group), so it has no controlling terminal:
  it still reads keys from stdin, but tools that open `/dev/tty` directly (some password prompts, full-screen TUIs) fail.
- A port can be taken between the claim and your server binding it. `strictPort` and bind errors make that a loud failure, not a silent
  drift.
- Pools are never compacted, so they can fragment. When no pool has room, the claim fails with a message naming every pool; remove unused
  folders' ranges from `~/.leeway/ranges.json`.
- There is no `leeway init`: write `leeway.json` by hand.
- `leeway list` and `leeway kill` scan listeners with `netstat` on Windows, `ss` on Linux and `lsof` on macOS. Without sudo on Linux and macOS they see
  only your own processes.
- `leeway kill` recognises a `leeway` run by its command line (`.../leeway/dist/cli.mjs`, or a `bin/leeway` or `.bin/leeway` link to it). A listener whose `leeway` run is gone is
  killed alone, so a watcher above it can still restart it.

## License

MIT
