<h1>
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/OhadC/leeway/main/docs/logo/lockup-dark.svg" />
        <img alt="leeway" src="https://raw.githubusercontent.com/OhadC/leeway/main/docs/logo/lockup.svg" height="64" />
    </picture>
</h1>

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
| `pinned`     | -       | ports every folder shares (see [Pinned ports](#pinned-ports))          |
| `agentGuard` | `false` | refuse default ports to agent shells (see [Agent guard](#agent-guard)) |

Unknown settings are refused, so a typo fails loudly, and so is a config that can't work, with the reason: `LEEWAY_ENV` or
`LEEWAY_FOLDER` as a port name, two port names that differ only by case, or two catalogue entries with the same `port`. Pinned ports may
share one, like `PORT_DB` and `PGPORT` for one Postgres.

### Pinned ports

Some ports should not move per folder: a local Postgres, or another repo's dev server, that every worktree uses at once. List them under
`pinned`, in the same shape as `ports`:

```json
{
    "ports": { "PORT_WEB": { "port": 5173 } },
    "pinned": { "PORT_DB": { "port": 5432, "description": "local postgres" } }
}
```

A pinned port keeps its `port` in every folder and every mode. leeway hands it down like any port, in the environment, `{{PORT_DB}}` and
`{{LEEWAY_ENV}}`, and marks it `pinned` in its table. It is never part of a range: the agent guard ignores it, and `leeway list` and
`leeway kill` never reach it. A pinned port inside one of the machine's pools is refused, since `leeway kill --orphans` would kill it
there. A name can't be in both `ports` and `pinned`. For a worktree that needs its own copy, move the entry to `ports` there without
committing it; its next claim grows the range by one.

leeway finds the config by walking up from the current directory; the nearest `leeway.json` wins, and the folder holding it is the
folder that owns the range. Commit it: every worktree gets its own copy and therefore its own range.

## Ranges

A folder's range comes from the machine's pools, 21000-29999 unless set otherwise with
[`leeway pools`](#leeway-pools-set-start-end--reset), and recorded in the registry, `~/.leeway/ranges.json`. Every repo on the machine
shares both, so no two folders get the same ports.

- A range is exactly as wide as the catalogue. Adding, reordering or renaming port names moves no port; removing one moves only the ports
  that fell outside the narrower range.
- A folder keeps its range while its ports are free (or held by its own servers). Otherwise the range moves to free ports and leeway warns:
  restart anything still on the old ports.
- leeway can't tell the folder's own servers from something else on one of its ports, so a claim that finds one in use keeps the range
  and names the holder with the fix: `leeway kill` for a server of this folder that should not still be running, [`leeway move`](#leeway-move) for anything else.

    ```
    leeway: 21001 (PORT_API) is in use by pid 4412 (postgres -D data), which leeway did not start; if it's this folder's, leeway kill; if not, leeway move
    leeway: 21000 (PORT_WEB) is in use by pid 5120 (node.exe vite.js), started by leeway; if it shouldn't still be running, stop it with leeway kill
    ```

- A deleted folder's range is freed by a later claim that needs room; `leeway release` frees a range right away, whether or not its
  folder still exists.
- Concurrent `leeway` runs never get the same range. A run that waits over 30 seconds for another fails, naming the lock file to delete
  if no `leeway` is running.

Default ports never claim a range. Tools that need every range on the machine read [`leeway list --json`](#leeway-list---json).

## In code: `devPorts`

```ts
import { devPorts } from "leeway";
import config from "./leeway.json" with { type: "json" };

const { PORT_API } = devPorts(config);

server.listen(PORT_API);
```

`devPorts(config)` returns one port per catalogue entry, then per pinned port: the environment variable if it is set, else the entry's `port`. A set
value that isn't an integer 1-65535 throws, naming the port name and the value. It is browser-safe: in the browser it reads the ports injected as `LEEWAY_ENV`, by the vite plugin or by `{{LEEWAY_ENV}}`
(see [Other bundlers](#other-bundlers)), and falls back to default ports when there are none.

### Agent guard

With `"agentGuard": true`, `devPorts` throws in an agent shell (`CLAUDECODE`, `GEMINI_CLI`, `CURSOR_AGENT` or `AI_AGENT` set) when none
of the catalogue's variables are set, so an agent can't silently start a server on your default ports. It is off by default. It is skipped
under vitest (`VITEST`) and jest (`JEST_WORKER_ID`). Codex sets no
reliable marker, and Copilot and Aider document none, so for them the guard can't fire; tell them to start servers through `leeway` (see
[Agents](#agents)).

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
- on `vite serve`, defines `LEEWAY_ENV` with every catalogue and pinned port, so `devPorts(config)` in browser code sees the same ports as the
  server. Builds keep default ports unless you pass `alwaysInject: true`.

## Other bundlers

A bundler with a define option gets the same browser ports from the `{{LEEWAY_ENV}}` placeholder, which becomes every catalogue and
pinned port as JSON. Angular CLI, for example:

```json
{
    "scripts": {
        "serve": "leeway ng serve --port {{PORT_WEB}} --define LEEWAY_ENV={{LEEWAY_ENV}}"
    }
}
```

## CLI

### `leeway [--default | --inherit] [--] <command>`

Runs `<command>` with every catalogue and pinned port in its environment.

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

- `{{NAME}}` anywhere in the command becomes that port. A `{{NAME}}` that is not a port name fails before anything is claimed or run.
- `{{LEEWAY_ENV}}` becomes every catalogue and pinned port as JSON, `{"PORT_WEB":21000,"PORT_API":21001}`, so `LEEWAY_ENV` can't be a port name.
  It needs the command as several arguments, which leeway quotes; in a one-argument shell line it fails before anything is claimed or run.
- `env`, `list`, `kill`, `move`, `release` and `pools` are leeway's own commands, and a flag before the command is leeway's: an unknown one fails with the usage. To
  run a command with one of those names, or starting with `-`, put `--` first: `leeway -- kill ...`.
- One argument is a shell line, run as-is: `leeway "vite build && vite preview"`. Several arguments are an argv: each is quoted for the
  shell when needed, so `leeway node -e "console.log(1)"` runs exactly that. On Windows a `.cmd` shim re-parses its arguments, so an
  argument holding both `"` and a cmd metacharacter like `&` can still break there.
- The command runs through the system shell (`sh`, `cmd.exe` on Windows).
- leeway exits with the shell's exit code (a missing command: 127 from `sh`, 1 from `cmd.exe`; a command killed by a signal: usually
  128 plus the signal number from `sh`), or 1 if the shell itself died from a signal or could not start.
- Stopping leeway (Ctrl+C, a signal, closing the terminal) stops the whole command tree.

`leeway --help` (or `-h`) prints the usage, `leeway --version` the version.

### `leeway env [--export]`

Claims this folder's range and prints it as dotenv lines, or with `--export` as shell export lines:

```sh
$ leeway env
PORT_WEB=21000
PORT_API=21001
$ leeway env --export
export PORT_WEB=21000
export PORT_API=21001
```

stdout carries only those lines; the port table and warnings go to stderr. If the range moved since the last claim, stderr says so:
restart anything still on the old ports. Under a `leeway` run for the same folder, either form prints the ports that run was given.

If the range stayed put but a port name's port changed, as when a port name is removed, stderr names each one:

```text
leeway: PORT_API moved from 21002 to 21001; restart anything still using the old port
```

Feed `leeway env` to anything that reads a dotenv file: `node --env-file`, `docker compose --env-file`, or a VS Code launch
configuration whose `preLaunchTask` writes the file:

```jsonc
// .vscode/tasks.json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "leeway env",
            "type": "shell",
            "command": "npx leeway env > .leeway.env",
            "windows": { "options": { "shell": { "executable": "cmd.exe", "args": ["/d", "/c"] } } }
        }
    ]
}

// .vscode/launch.json, in a configuration
"preLaunchTask": "leeway env",
"envFile": "${workspaceFolder}/.leeway.env"
```

Keep the `cmd.exe` shell on Windows: Windows PowerShell's `>` writes a file dotenv readers can't read.

Use `eval "$(leeway env --export)"` to give a shell its range, after which `devPorts` and tools started without `leeway`
pick the ports up. In PowerShell:

```powershell
leeway env | ForEach-Object { $name, $value = $_ -split '=', 2; Set-Item "Env:$name" $value }
```

### `leeway list [--json]`

Every registered range on the machine, from every repo, with the pid and short command listening on each port, followed by orphans:
listeners in any of the machine's pools outside every range (for example a server left behind by a deleted worktree). The range of the
folder you are in is marked `(this folder)`.

```text
/home/me/app  21000-21001  (this folder)
  PORT_WEB  21000  pid 4120  node vite.js
  PORT_API  21001  -

orphans (in a pool, outside every range)
  21007  pid 5532  node server.js --watch
```

The short command keeps the last path segment of each word, cut to 60 characters. Listing reads the process table, which takes a second
or two on Windows.

`--json` prints the same as JSON, with full command lines by pid, for tools; read this rather than the registry, which may list deleted
folders:

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
    "orphans": [{ "port": 21007, "pid": 5532 }],
    "commands": {
        "4120": "/usr/bin/node /home/me/app/node_modules/vite/bin/vite.js",
        "5532": "/usr/bin/node /home/me/old/server.js --watch"
    }
}
```

`folder` is lowercased on Windows.

### `leeway kill [<port> | --orphans]`

Kills every process tree listening in this folder's range, or with a port, in the range that contains it (any repo's). A listener started
under `leeway` is killed with the nearest `leeway` run above it and that run's whole tree, so a watcher between them (`tsx watch`,
`nodemon`) can't restart it; that takes down whatever else the run started too, like a `tsc --watch` beside the server under the same
`concurrently`. A port in a pool outside every range is an orphan: `leeway kill <port>` kills just the listeners on that port, never
their run. Ports outside every range and every pool are refused. `leeway kill --orphans` kills every orphan in every pool the same way,
exactly the ones `leeway list` shows, and leaves living ranges alone.

### `leeway move`

Claims this folder a new range sharing no port with its current one, for when something else holds one of its ports. It prints the new
ports and the moved warning, and kills nothing: restart the folder's servers so they take the new ports. A folder without a range gets a
plain claim.

### `leeway release [<folder>]`

Drops this folder's range from the registry, or with a path, that folder's (with or without a `leeway.json`, existing or not), so its
ports go back to the pools; the folder's next claim places a new range.

```sh
$ leeway release ~/old-clone
leeway: released 21000-21001 for /home/me/old-clone
  pid 4120  21000  still listening, now an orphan; stop it with leeway kill 21000
```

It never kills anything: what still listens in the released range, inside a pool, is listed as an orphan. A folder without a range fails, and nothing is
written.

### `leeway pools [set <start-end>... | reset]`

The machine's pools, the blocks of ports every repo's ranges come from. For machines where 21000-29999 is a poor fit, for example when a
firewall allows only certain ports or ports are forwarded into a container or VM.

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
- The pools are stored as `pools` in `~/.leeway/ranges.json`. A hand edit leeway can't read fails claims, `leeway list`, `leeway release`,
  printing the pools, and `leeway kill` with `--orphans` or a port outside every range, until you fix it, for example with `leeway pools set` or `leeway pools reset`.

**WSL beside Windows**: each side has its own `~/.leeway/ranges.json`, while WSL forwards its ports to Windows `localhost`. Both
start from the default pool and can claim the same range; give each side its own pools, for example `leeway pools set 21000-24999` on
Windows and `leeway pools set 25000-29999` in WSL.

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

**Other agents** (Codex, Gemini CLI, Cursor, Copilot, Aider, ...): tell them in `AGENTS.md` to start servers with
`leeway <command>`. Where the agent sets a marker, turning on the agent guard catches the times it forgets.

## Recipes

### Turbo

Turbo 2 runs tasks in strict env mode by default: a task sees only the environment variables `turbo.json` lists. Under
`leeway turbo dev`, turbo gets the ports but its tasks don't, so their servers start on default ports and collide. List the port names,
here with a wildcard, and `LEEWAY_FOLDER`, so a `leeway` call inside a task is a nested call and runs on turbo's ports:

```json
{
    "globalPassThroughEnv": ["PORT_*", "LEEWAY_FOLDER"]
}
```

Match the wildcard to your port names. Pass-through variables stay out of turbo's cache hash.

### Frameworks with a port flag or `PORT`

Pass the port with a placeholder:

```json
{
    "scripts": {
        "dev": "leeway next dev -p {{PORT_WEB}}"
    }
}
```

Servers that read `PORT` by convention, like Next.js and Nuxt, need no flag when the catalogue has a port named `PORT`: `leeway next dev`. Nuxt prefers
`NUXT_PORT` and `NITRO_PORT` when set.

### Playwright

Run the tests as `leeway playwright test`. `playwright.config.ts` reads the ports with `devPorts`, and the `webServer` command `leeway vite` is a
nested call, so it serves on the ports the tests use:

```ts
import { defineConfig } from "@playwright/test";
import { devPorts } from "leeway";
import config from "./leeway.json" with { type: "json" };

const baseURL = `http://localhost:${devPorts(config).PORT_WEB}`;

export default defineConfig({
    use: { baseURL },
    webServer: { command: "leeway vite", url: baseURL },
});
```

### docker compose

Compose fills `${PORT_DB}` from the environment, so run it as `leeway docker compose up`:

```yaml
services:
    db:
        image: postgres
        ports: ["${PORT_DB}:5432"]
```

### A Postgres every folder shares

Move `PORT_DB` from `ports` to `pinned` in the [docker compose](#docker-compose) recipe: `leeway docker compose up -d` in any worktree
starts the one Postgres on 5432, and `devPorts(config).PORT_DB` is 5432 in every worktree.

### A URL in `.env`

Vite fills `${PORT_API}` in `.env` from the environment, so under `leeway vite` this is the folder's port, and without `leeway` the
default port after `:-`:

```sh
VITE_API_URL=http://localhost:${PORT_API:-3001}
```

`node --env-file` does not expand it.

### Preview of a build

`devPorts` in a build keeps default ports, so `leeway "vite build && vite preview"` serves the bundle on the folder's port, but the bundle
calls default ports. Inject the ports into builds run under `leeway` only:

```ts
leeway({ config, port: "PORT_WEB", alwaysInject: Boolean(process.env.LEEWAY_FOLDER) });
```

A plain `vite build` still gets default ports, even in a shell given its range by `leeway env`.

### direnv

An `.envrc` that gives every shell in the folder its range, and with it any agent working there:

```sh
eval "$(npx leeway env --export)"
```

## Limits

- A hard kill of `leeway` itself (SIGKILL, Task Manager, `taskkill /F` on leeway alone) skips its cleanup and can leave the command
  tree running. Recover with `leeway kill` in that folder.
- On Windows, a command that exits while leaving background grandchildren behind can leave them running too; `leeway kill` again.
- On Linux and macOS the command runs in its own session, so it has no controlling terminal:
  it still reads keys from stdin, but tools that open `/dev/tty` directly (some password prompts, full-screen TUIs) fail.
- Ctrl+Z on Linux and macOS suspends `leeway` alone: the command, in its own session, keeps running on its ports. `fg`, then Ctrl+C,
  stops it.
- `nohup leeway <command>` doesn't outlive the terminal: `leeway` still gets the hangup and stops the command tree. In bash or zsh, use
  `leeway <command> > leeway.log 2>&1 & disown` instead.
- On Windows, Ctrl+C force-kills the command tree at once, so a command that cleans up on Ctrl+C may die before it finishes. Run such a
  command in the background and stop it with its own stop command.
- A port can be taken between the claim and your server binding it. `strictPort` and bind errors make that a loud failure, not a silent
  drift; `leeway move` gets the folder a new range.
- Pools are never compacted, so they can fragment. When no pool has room, the claim fails with a message naming every pool; release unused
  folders' ranges with `leeway release <folder>`.
- leeway before 0.3 ignores pools: a repo on an older version still claims in 21000-29999, whatever `leeway pools set` says.
- There is no `leeway init`: write `leeway.json` by hand.
- `leeway list` and `leeway kill` scan listeners with `netstat` on Windows, `ss` on Linux and `lsof` on macOS. Without sudo on macOS they see
  only your own processes. Without sudo on Linux they see other users' listeners without a pid: `leeway list` shows `pid ?` (`null` in
  `--json`), and `leeway kill` reports them as failed and exits 1.
- A listener whose `leeway` run is gone is killed alone by `leeway kill`, so a watcher above it can still restart it.

## License

MIT
