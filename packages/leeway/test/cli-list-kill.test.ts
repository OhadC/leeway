import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessTree } from "../src/process-tree.ts";
import { RangeRegistry } from "../src/range-registry.ts";
import { LeewayCli } from "./leeway-cli.ts";

const SERVER = 'require("node:net").createServer().listen(Number(process.argv[1]), () => console.log("listening"));';

const WATCHER = `import { spawn } from "node:child_process";
const server = ${JSON.stringify(SERVER)};
const start = () => spawn(process.execPath, ["-e", server, process.env.PORT_WEB], { stdio: "inherit" }).on("exit", start);
start();
`;

const KEEPER = `import { spawn } from "node:child_process";
spawn(process.execPath, ["-e", ${JSON.stringify(SERVER)}, process.argv[2]], { stdio: "inherit" });
setInterval(() => {}, 1000);
`;

const servers: ChildProcess[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(stopServer));
    LeewayCli.removeTemporaryDirs();
});

describe("leeway list and kill", () => {
    it("lists a server listening in the folder's range with its pid", async () => {
        const { dir, home, ports } = claimedFolder();
        const server = await startServer(ports.PORT_WEB);

        const result = LeewayCli.run(["list"], dir, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`${shown(dir)}  ${ports.PORT_WEB}-${ports.PORT_API}`);
        expect(result.stdout).toContain(`PORT_WEB  ${ports.PORT_WEB}  pid ${server.pid}`);
        expect(result.stdout).toContain(`PORT_API  ${ports.PORT_API}  -`);
    }, 60_000);

    it("lists every range as JSON with --json", async () => {
        const { dir, home, ports } = claimedFolder();
        const server = await startServer(ports.PORT_WEB);

        const result = LeewayCli.run(["list", "--json"], dir, home);

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout).ranges).toEqual([
            {
                folder: shown(dir),
                start: ports.PORT_WEB,
                end: ports.PORT_API,
                ports: [
                    { name: "PORT_WEB", port: ports.PORT_WEB, pids: [server.pid] },
                    { name: "PORT_API", port: ports.PORT_API, pids: [] },
                ],
            },
        ]);
    }, 60_000);

    it("kills what listens in the current folder's range", async () => {
        const { dir, home, ports } = claimedFolder();
        const server = await startServer(ports.PORT_WEB);

        const result = LeewayCli.run(["kill"], dir, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`pid ${server.pid}  PORT_WEB ${ports.PORT_WEB}  killed`);
        expect(await accepts(ports.PORT_WEB)).toBe(false);
    }, 60_000);

    it("kills the leeway run above a listener, so a watcher can't restart it", async () => {
        const { dir, home, ports } = claimedFolder();
        fs.writeFileSync(path.join(dir, "watcher.mjs"), WATCHER);
        const leeway = LeewayCli.start(["node", "watcher.mjs"], dir, home);
        const exited = new Promise(resolve => leeway.once("exit", resolve));

        servers.push(leeway);
        await new Promise(resolve => leeway.stdout?.once("data", resolve));

        const result = LeewayCli.run(["kill"], dir, home);

        expect(result.stdout).toContain(`PORT_WEB ${ports.PORT_WEB}  killed`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        expect(await accepts(ports.PORT_WEB)).toBe(false);
        await exited;
    }, 60_000);

    it("kills an orphan listening in the pool outside every range", async () => {
        const { home, pool } = claimedFolder();
        const orphanPort = pool.end;
        const server = await startServer(orphanPort);

        const result = LeewayCli.run(["kill", String(orphanPort)], home, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`leeway: orphan port ${orphanPort}\n  pid ${server.pid}  ${orphanPort}  killed\n`);
        expect(await accepts(orphanPort)).toBe(false);
    }, 60_000);

    it("lists and kills an orphan listening in a pool the machine's owner set", async () => {
        const { dir, home } = LeewayCli.folder();
        const [orphanPort] = await freePorts(1);
        const server = await startServer(orphanPort);

        LeewayCli.run(["pools", "set", `${orphanPort}-${orphanPort}`], dir, home);
        const listed = LeewayCli.run(["list"], dir, home);
        const killed = LeewayCli.run(["kill", String(orphanPort)], dir, home);

        expect(listed.stdout).toBe(`orphans (in a pool, outside every range)\n  ${orphanPort}  pid ${server.pid}\n`);
        expect(killed.stdout).toBe(`leeway: orphan port ${orphanPort}\n  pid ${server.pid}  ${orphanPort}  killed\n`);
        expect(await accepts(orphanPort)).toBe(false);
    }, 60_000);

    it("kills only the listener on an orphan port, leaving the leeway run above it", async () => {
        const { dir, home, pool } = claimedFolder();
        const orphanPort = pool.end;
        fs.writeFileSync(path.join(dir, "keeper.mjs"), KEEPER);
        const leeway = LeewayCli.start(["node", "keeper.mjs", String(orphanPort)], dir, home);

        servers.push(leeway);
        await new Promise(resolve => leeway.stdout?.once("data", resolve));

        const result = LeewayCli.run(["kill", String(orphanPort)], home, home);

        expect(result.stdout).toContain(`${orphanPort}  killed`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        expect(await accepts(orphanPort)).toBe(false);
        expect(leeway.exitCode).toBeNull();
    }, 60_000);

    it("kills every orphan with --orphans, leaving what listens in a range", async () => {
        const { dir, home } = LeewayCli.folder();
        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify({ ports: { PORT_WEB: { port: 5173 } } }));
        const [rangePort, firstOrphanPort, secondOrphanPort] = await freePorts(3);
        LeewayCli.run(["pools", "set", ...[rangePort, firstOrphanPort, secondOrphanPort].map(port => `${port}-${port}`)], dir, home);
        LeewayCli.run(["env", "--export"], dir, home);
        const inRange = await startServer(rangePort);
        const firstOrphan = await startServer(firstOrphanPort);
        const secondOrphan = await startServer(secondOrphanPort);

        const result = LeewayCli.run(["kill", "--orphans"], home, home);

        const [heading, ...kills] = result.stdout.trimEnd().split("\n");

        expect(heading).toBe(
            `leeway: ${rangePort}-${rangePort}, ${firstOrphanPort}-${firstOrphanPort}, ${secondOrphanPort}-${secondOrphanPort} outside every range`,
        );
        expect(kills.sort()).toEqual(
            [`  pid ${firstOrphan.pid}  ${firstOrphanPort}  killed`, `  pid ${secondOrphan.pid}  ${secondOrphanPort}  killed`].sort(),
        );
        expect(await accepts(firstOrphanPort)).toBe(false);
        expect(await accepts(secondOrphanPort)).toBe(false);
        expect(await accepts(rangePort)).toBe(true);
        expect(inRange.exitCode).toBeNull();
    }, 60_000);

    it("says so when there are no orphans, naming the pools", async () => {
        const { dir, home } = LeewayCli.folder();
        const [port] = await freePorts(1);
        const pool = `${port}-${port}`;
        LeewayCli.run(["pools", "set", pool], dir, home);

        const result = LeewayCli.run(["kill", "--orphans"], dir, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`leeway: nothing is listening in ${pool} outside every range\n`);
    }, 60_000);

    it("refuses --orphans with a port, printing the usage", () => {
        const { home, ports } = claimedFolder();

        const result = LeewayCli.run(["kill", "--orphans", String(ports.PORT_WEB)], home, home);

        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/^usage: leeway/);
    }, 60_000);

    it("kills the range holding a given port from any folder", async () => {
        const { home, ports } = claimedFolder();
        const server = await startServer(ports.PORT_WEB);

        const result = LeewayCli.run(["kill", String(ports.PORT_API)], home, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`pid ${server.pid}  PORT_WEB ${ports.PORT_WEB}  killed`);
        expect(await accepts(ports.PORT_WEB)).toBe(false);
    }, 60_000);

    it("kills the range holding a given port while the pools are unreadable, and refuses an orphan port", () => {
        const { dir, home, ports } = claimedFolder();
        const registryPath = RangeRegistry.defaultPath(home);
        fs.writeFileSync(registryPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(registryPath, "utf8")), pools: "41000-41999" }));

        const inRange = LeewayCli.run(["kill", String(ports.PORT_API)], home, home);
        const orphan = LeewayCli.run(["kill", String((ports.PORT_API ?? 0) + 100)], home, home);

        expect(inRange.status).toBe(0);
        expect(inRange.stdout).toBe(`leeway: nothing is listening in ${shown(dir)}  ${ports.PORT_WEB}-${ports.PORT_API}\n`);
        expect(orphan.status).toBe(1);
        expect(orphan.stderr).toMatch(/^leeway: the pools in .*; fix it/);
    }, 60_000);

    it("says so when nothing listens in the range", () => {
        const { dir, home, ports } = claimedFolder();

        const result = LeewayCli.run(["kill"], dir, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`leeway: nothing is listening in ${shown(dir)}  ${ports.PORT_WEB}-${ports.PORT_API}\n`);
    }, 60_000);
});

describe("leeway release", () => {
    it("releases this folder's range, so leeway list no longer shows it and the next claim takes the ports again", () => {
        const { dir, home, ports } = claimedFolder();
        const other = LeewayCli.folder().dir;
        LeewayCli.run(["env", "--export"], other, home);

        const result = LeewayCli.run(["release"], dir, home);
        const listed = LeewayCli.run(["list", "--json"], dir, home);
        const reclaimed = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], LeewayCli.folder().dir, home).stdout);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`leeway: released ${ports.PORT_WEB}-${ports.PORT_API} for ${shown(dir)}\n`);
        expect(JSON.parse(listed.stdout).ranges.map((range: { folder: string }) => range.folder)).toEqual([shown(other)]);
        expect(reclaimed).toEqual(ports);
    }, 60_000);

    it("releases a folder given by path from anywhere, even once the folder is gone", () => {
        const { dir, home, ports } = claimedFolder();
        fs.rmSync(dir, { recursive: true, force: true });

        const result = LeewayCli.run(["release", dir], home, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`leeway: released ${ports.PORT_WEB}-${ports.PORT_API} for ${shown(dir)}\n`);
    }, 60_000);

    it("fails for a folder without a range and writes nothing", () => {
        const { dir, home } = claimedFolder();
        const registryPath = RangeRegistry.defaultPath(home);
        const before = fs.readFileSync(registryPath, "utf8");

        const result = LeewayCli.run(["release", path.join(dir, "typo")], dir, home);

        expect(result.status).toBe(1);
        expect(result.stderr).toBe(`leeway: ${path.join(dir, "typo")} has no range\n`);
        expect(fs.readFileSync(registryPath, "utf8")).toBe(before);
    }, 60_000);

    it("says what still listens in the released range is an orphan now, and leaves it running", async () => {
        const { dir, home, ports } = claimedFolder();
        const server = await startServer(ports.PORT_WEB);

        const result = LeewayCli.run(["release"], dir, home);
        const listed = LeewayCli.run(["list", "--json"], dir, home);

        expect(result.stdout).toBe(
            `leeway: released ${ports.PORT_WEB}-${ports.PORT_API} for ${shown(dir)}\n` +
                `  pid ${server.pid}  ${ports.PORT_WEB}  still listening, now an orphan; stop it with leeway kill ${ports.PORT_WEB}\n`,
        );
        expect(await accepts(ports.PORT_WEB)).toBe(true);
        expect(JSON.parse(listed.stdout).orphans).toEqual([{ port: ports.PORT_WEB, pid: server.pid }]);
    }, 60_000);

    it("calls no listener an orphan when the released range lies outside the pools", async () => {
        const { dir, home, ports } = claimedFolder();
        await startServer(ports.PORT_WEB);
        LeewayCli.run(["pools", "set", "40000-40999"], dir, home);

        const result = LeewayCli.run(["release"], dir, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`leeway: released ${ports.PORT_WEB}-${ports.PORT_API} for ${shown(dir)}\n`);
    }, 60_000);
});

function claimedFolder() {
    const folder = LeewayCli.folder();
    const ports = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], folder.dir, folder.home).stdout);

    return { ...folder, ports };
}

function shown(dir: string): string {
    return process.platform === "win32" ? dir.toLowerCase() : dir;
}

function startServer(port: number | undefined): Promise<ChildProcess> {
    const server = spawn(process.execPath, ["-e", SERVER, String(port)], { stdio: ["ignore", "pipe", "inherit"] });

    servers.push(server);

    return new Promise((resolve, reject) => {
        server.stdout?.once("data", () => resolve(server));
        server.once("exit", code => reject(new Error(`server exited with ${code} before listening`)));
    });
}

async function stopServer(server: ChildProcess): Promise<void> {
    if (server.exitCode !== null || server.signalCode !== null) {
        return;
    }

    const exited = new Promise(resolve => server.once("exit", resolve));

    ProcessTree.killTreeQuietly(server.pid ?? 0);
    await exited;
}

async function freePorts(count: number): Promise<number[]> {
    const holders = Array.from({ length: count }, () => net.createServer());
    const ports = await Promise.all(
        holders.map(holder => new Promise<number>(resolve => holder.listen(0, () => resolve((holder.address() as net.AddressInfo).port)))),
    );

    await Promise.all(holders.map(holder => new Promise(resolve => holder.close(resolve))));

    return ports;
}

function accepts(port: number | undefined): Promise<boolean> {
    return new Promise(resolve => {
        const socket = net.connect({ host: "127.0.0.1", port: port ?? 0 }, () => {
            socket.destroy();
            resolve(true);
        });

        socket.once("error", () => resolve(false));
    });
}
