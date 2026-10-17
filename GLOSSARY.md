# leeway

Per-folder dev port ranges: every folder that declares its ports gets its own stable block of ports, so parallel worktrees, repos and
agents never fight over them.

## Language

### Ports

**Catalogue**:
The list of ports a repo's dev setup uses, each with a port name and a default port, declared in `leeway.json`.
_Avoid_: config, manifest, port map

**Port name**:
A catalogue entry's name; it is also the environment variable the port travels in.
_Avoid_: key, slot, service

**Default port**:
The port a catalogue entry uses when no range applies; each repo's own business and free to collide across repos.
_Avoid_: base port, usual port, fixed port

### Ownership

**Folder**:
The folder holding the nearest catalogue; the unit that owns a range.
_Avoid_: root, project, worktree, repo

**Pool**:
The fixed block of ports, 21000-29999, every range comes from; being in the pool is what makes a port leeway's.
_Avoid_: port space, allocation range

**Range**:
A folder's contiguous block of ports from the pool, exactly as wide as its catalogue, one port per port name.
_Avoid_: block, slot, allocation

**Registry**:
The machine-wide record of every folder's range, shared by every repo.
_Avoid_: state, database, lockfile

**Claim**:
Taking a range for a folder: its current range when still usable, else the lowest usable gap. A range that changes on a claim has moved.
_Avoid_: allocate, assign, lease, reserve

**Living range**:
A range whose folder still exists. Ranges of deleted folders stop counting and are dropped on the next claim.
_Avoid_: active, valid, stale

### Processes

**Orphan**:
A process listening on a pool port outside every living range, typically a server left behind by a deleted worktree.
_Avoid_: stray, leftover, zombie

### Agents

**Agent shell**:
A shell an AI coding agent runs commands in, recognised by a marker environment variable the agent sets.
_Avoid_: AI session, bot

**Agent guard**:
The refusal to hand default ports to an agent shell that has no ports of its own.
_Avoid_: agent check, safety net
