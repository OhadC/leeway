# leeway

Per-folder dev port ranges: every folder that declares its ports gets its own stable block of ports, so parallel worktrees, repos and
agents never fight over them.

## Language

### Ports

**Config**:
A repo's `leeway.json`: its catalogue plus the settings that apply to it.
_Avoid_: settings file, manifest

**Catalogue**:
The list of ports a repo's dev setup uses, each with a port name and a default port; the `ports` of the config.
_Avoid_: port map, port list

**Port name**:
A catalogue entry's name; it is also the environment variable the port travels in.
_Avoid_: key, slot, service

**Default port**:
The port a catalogue entry uses when no range applies; each repo's own business and free to collide across repos.
_Avoid_: base port, usual port, fixed port

### Ownership

**Folder**:
The folder holding the nearest config; the unit that owns a range.
_Avoid_: root, project, worktree, repo

**Pool**:
A block of ports ranges come from. The machine has one or more, set by its owner, else the default pool. A range never spans two, and
being in a pool is what makes an unclaimed port presumed leeway's.
_Avoid_: port space, allocation range, window

**Default pool**:
21000-29999, the pool of a machine whose owner set none.

**Range**:
A folder's contiguous block of ports. A claim places it inside one pool, exactly as wide as its catalogue, one port per port name; in the
registry, a readable range holds its ports wherever it sits and whatever its width.
_Avoid_: block, slot, allocation

**Readable range**:
A registry entry's `start`-`end` when both are ports 1-65535 with `start` ≤ `end`, whatever else the entry holds. Only a readable range
holds ports; any other entry is passed through untouched.
_Avoid_: usable range

**Registry**:
The machine-wide record of the machine's pools and every folder's range, shared by every repo.
_Avoid_: state, database, lockfile

**Claim**:
Taking a range for a folder: its current range when still usable, else the first usable gap, pools in set order and each pool low to
high. A range that changes on a claim has moved.
_Avoid_: allocate, assign, lease, reserve

**Living range**:
A range whose folder still exists. Ranges of deleted folders stop counting and are dropped the next time a claim has to place a range.
_Avoid_: active, valid, stale

### Running

**Mode**:
How a leeway call picks its ports: claim the folder's range, take the default ports, or inherit the ports already in the environment.
_Avoid_: flag, strategy, setting

**Placeholder**:
`{{NAME}}` in a command: a port name stands for that port, and `LEEWAY_ENV` for every port as JSON.
_Avoid_: template, variable, token

### Processes

**Orphan**:
A process listening on a port in a pool, outside every living range, typically a server left behind by a deleted worktree.
_Avoid_: stray, leftover, zombie

### Agents

**Agent shell**:
A shell an AI coding agent runs commands in, recognised by a marker environment variable the agent sets.
_Avoid_: AI session, bot

**Agent guard**:
The refusal to hand default ports to an agent shell that has no ports of its own; off unless the config turns it on.
_Avoid_: agent check, safety net
