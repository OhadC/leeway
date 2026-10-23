# leeway

[![npm](https://img.shields.io/npm/v/leeway)](https://www.npmjs.com/package/leeway)
[![ci](https://github.com/OhadC/leeway/actions/workflows/ci.yml/badge.svg)](https://github.com/OhadC/leeway/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/OhadC/leeway)](LICENSE)

Per-folder dev port ranges, so parallel worktrees and AI agents never fight over ports.

Two checkouts of the same repo both want port 5173. One fails with `EADDRINUSE`, or vite quietly moves to 5174 and the other worktree's
tests talk to the wrong server. Run three agents in three worktrees and this happens all day.

leeway gives every folder its own stable, contiguous range of ports and hands them to your servers as environment variables:

```sh
$ leeway vite
leeway: ports 21000-21001 for /home/me/app
  PORT_WEB  21000
  PORT_API  21001
```

The worktree next door gets 21002-21003, and keeps that range on every run.

## Quick start

```sh
npm install -D leeway
```

List your dev ports once, in a `leeway.json` at the top of the repo, and commit it:

```json
{
    "ports": {
        "PORT_WEB": { "port": 5173 },
        "PORT_API": { "port": 3001 }
    }
}
```

Start servers through `leeway`:

```json
{
    "scripts": {
        "dev": "leeway vite",
        "api": "leeway node server.ts"
    }
}
```

Read the ports in code with `devPorts`, which falls back to the default ports when not run under `leeway`:

```ts
import { devPorts } from "leeway";
import config from "./leeway.json" with { type: "json" };

server.listen(devPorts(config).PORT_API);
```

Or let the vite plugin set `server.port` with `strictPort`, and pass every port to browser code:

```ts
import { leeway } from "leeway/vite";
import { defineConfig } from "vite";
import config from "./leeway.json" with { type: "json" };

export default defineConfig({ plugins: [leeway({ config, port: "PORT_WEB" })] });
```

## What you get

- **Stable ranges**: a folder keeps its range across runs, recorded in a machine-wide registry (`~/.leeway/ranges.json`), so bookmarks
  and env files keep working.
- **No collisions**: ranges come from the machine's pools (21000-29999 unless you set others with `leeway pools set`), never overlap,
  and skip ports already taken. Concurrent runs are serialised by a lock.
- **Default ports still work**: `leeway --default vite` runs on the ports in `leeway.json`, and code reading `devPorts` outside `leeway` gets
  them too.
- **Placeholders**: `leeway curl http://localhost:{{PORT_API}}` puts the port in the command.
- **Cleanup**: `leeway list` shows every range on the machine with what is listening, plus orphans left by deleted worktrees.
  `leeway kill` stops a folder's servers, including the watcher that would restart them.
- **Agents**: `leeway env --export` in a Claude Code SessionStart hook gives every agent session its range up front. The opt-in agent
  guard makes `devPorts` refuse default ports in an agent shell that has none.
- Linux, macOS and Windows. Node >= 22.18.

## Docs

The full reference is in [packages/leeway/README.md](packages/leeway/README.md): config, how claims work, the vite plugin, every CLI
command and mode, agent setup and known limits. Design decisions are in [docs/adr](docs/adr), terms in [GLOSSARY.md](GLOSSARY.md).

## Repo layout

- [packages/leeway](packages/leeway): the library and CLI, published to npm as [`leeway`](https://www.npmjs.com/package/leeway)
- [examples/playground](examples/playground): a vite app and an api server wired through leeway, for trying it by hand

## Development

```sh
pnpm install
pnpm verify        # typecheck + lint + tests, once
pnpm test          # vitest in watch mode
pnpm test:linux    # the same suite in a Linux container (podman)
pnpm build
```

Formatting runs on commit through a pre-commit hook; CI checks it.

## License

[MIT](LICENSE)
