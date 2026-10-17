# leeway

Per-folder dev port ranges, so parallel worktrees and AI agents never fight over ports.

Two checkouts of the same repo both want port 5173. One fails with `EADDRINUSE`, or vite quietly moves to 5174 and the other worktree's
tests talk to the wrong server. leeway gives every folder its own stable, contiguous range of ports and hands them to your servers as
environment variables.

```sh
$ leeway exec --claim -- vite
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

## The catalogue: `leeway.json`

One `leeway.json` at the repo root lists every port your dev setup uses. The key is the environment variable (letters, digits and `_`, not starting with a digit), `port` is its default
port. Any other properties are yours; leeway ignores them.

```json
{
    "PORT_WEB": { "port": 5173 },
    "PORT_API": { "port": 3001, "description": "mock api" }
}
```

leeway finds the catalogue by walking up from the current directory; the nearest `leeway.json` wins, and the folder holding it is the
folder that owns the range. Commit it: every worktree gets its own copy and therefore its own range.

## Ranges and the registry

A folder's range is claimed from the pool 21000-29999 and recorded in the machine-wide registry `~/.leeway/ranges.json`, shared by every
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
- A claim keeps the folder's current range whenever its ports are still free (or held by the folder's own running servers). Otherwise
  it takes the lowest gap that overlaps no other range and whose ports can all be bound, and warns that the range moved.
- Ports held by something else, or reserved by the OS, are skipped at claim time.
- Ranges of folders that no longer exist are dropped on the next claim.
- Claims are serialised by a lock next to the registry, so concurrent `leeway` runs never get the same range.

Default ports never touch the registry.

## In code: `devPorts`

```ts
import { devPorts } from "leeway";
import catalogue from "./leeway.json" with { type: "json" };

const { PORT_API } = devPorts(catalogue);

server.listen(PORT_API);
```

`devPorts(catalogue)` returns one port per catalogue entry: the entry's environment variable if it is set to a port, else the default
port. It is browser-safe: in the browser it reads the ports the vite plugin injected (see below), and falls back to default ports when
there are none.

**Agent guard.** In an agent shell (`CLAUDECODE`, `GEMINI_CLI`, `CURSOR_AGENT` or `AI_AGENT` set), `devPorts` throws if none of the
catalogue's variables are set, so an agent can't silently start a server on your default ports. It is skipped under `VITEST`, because app
modules often read ports at import time in tests. Codex sets no reliable marker, and Copilot and Aider document none, so for them the
guard can't fire; tell them to use `leeway exec --claim` (see [Agents](#agents)).

## Vite: `leeway/vite`

```ts
import { leeway } from "leeway/vite";
import { defineConfig } from "vite";
import catalogue from "./leeway.json" with { type: "json" };

export default defineConfig({
    plugins: [leeway({ catalogue, port: "PORT_WEB", preview: "PORT_WEB" })],
});
```

Passing the catalogue types `port` and `preview` against its names. Without it, the plugin finds `leeway.json` from vite's `root`:

```ts
leeway({ port: "PORT_WEB" });
```

The plugin:

- sets `server.port` (and `preview.port` when `preview` is given) from `devPorts`, with `strictPort: true`, so a taken port fails loudly
  instead of drifting to port+1;
- on `vite serve`, defines `__LEEWAY_ENV__` with every catalogue port, so `devPorts(catalogue)` in browser code sees the same ports as the
  server. Builds keep default ports unless you pass `alwaysInject: true`.

## CLI

### `leeway exec [--claim | --defaults] [--] <command>`

Runs `<command>` with every catalogue port in its environment.

| mode         | ports                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| (no flag)    | `devPorts`: environment variables, else default ports; agent guard applies |
| `--claim`    | this folder's range, claimed in the registry                               |
| `--defaults` | default ports, ignoring the environment and the agent guard                |

`--claim` and `--defaults` print the port table on stderr.

```json
{
    "scripts": {
        "dev": "leeway exec --claim -- vite",
        "dev:defaults": "leeway exec --defaults -- vite",
        "wait:api": "leeway exec -- wait-on tcp:{{PORT_API}}"
    }
}
```

- `{{NAME}}` anywhere in the command becomes that port.
- One argument is a shell line, run as-is: `leeway exec --claim "vite build && vite preview"`. Several arguments are an argv: each is quoted for the
  shell when needed, so `leeway exec -- node -e "console.log(1)"` runs exactly that.
- The command runs through the system shell (`sh`, `cmd.exe` on Windows).
- leeway exits with the command's exit code, or 1 if it died from a signal or could not start.
- Stopping leeway stops the whole command tree. On Linux and macOS the command runs in its own process group and SIGINT, SIGTERM and SIGHUP
  are forwarded to the group. On Windows, Ctrl+C, Ctrl+Break or closing the console kills the tree with `taskkill /T /F`.

### `leeway env --export`

Claims this folder's range and prints it as shell export lines:

```sh
$ leeway env --export
export PORT_WEB=21000
export PORT_API=21001
```

stdout carries only `export NAME=port` lines; the port table and warnings go to stderr. If the range moved since the last claim, stderr
says so: restart anything still on the old ports. Use it as `eval "$(leeway env --export)"` to give a shell its range, after which plain
`leeway exec` and `devPorts` pick the ports up.

### `leeway list`

Every registered range on the machine, from every repo, with the pid listening on each port, followed by orphans: listeners in the pool
outside every range (for example a server left behind by a deleted worktree).

```text
/home/me/app  21000-21001
  PORT_WEB  21000  pid 4120
  PORT_API  21001  -

orphans (in the pool, outside every range)
  21007  pid 5532
```

### `leeway kill [<port>]`

Kills every process tree listening in this folder's range, or with a port, in the range that contains it (any repo's). A pool port
outside every range is an orphan: `leeway kill <port>` kills just the listeners on that port. Ports outside the pool are refused.

## Agents

**Claude Code**: give every session its range up front with a SessionStart hook in `.claude/settings.json`. Claude Code sources
`$CLAUDE_ENV_FILE` before each Bash command, so every server the agent starts sees the ports, through `vite`, `devPorts` and plain
`leeway exec` alike:

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
`leeway exec --claim -- <command>`. Where the agent sets a marker, the agent guard catches the times it forgets.

## Limits

- A hard kill of `leeway exec` itself (SIGKILL, Task Manager, `taskkill /F` on leeway alone) skips its cleanup and can orphan the command
  tree. Recover with `leeway kill` in that folder.
- On Windows, a command that exits while leaving background grandchildren behind can orphan them too; `leeway kill` again.
- On Linux and macOS the command runs in its own session (that is how it gets its own process group), so it has no controlling terminal:
  it still reads keys from stdin, but tools that open `/dev/tty` directly (some password prompts, full-screen TUIs) fail.
- A port can be taken between the claim and your server binding it. `strictPort` and bind errors make that a loud failure, not a silent
  drift.
- The pool is never compacted, so it can fragment. A full pool fails with a message; remove unused folders' ranges from
  `~/.leeway/ranges.json`.
- The pool is not configurable, and there is no `leeway init`: write `leeway.json` by hand.
- `leeway list` and `leeway kill` scan listeners with PowerShell on Windows, `ss` on Linux and `lsof` on macOS. Without root on Linux and macOS they see
  only your own processes.

## License

MIT
