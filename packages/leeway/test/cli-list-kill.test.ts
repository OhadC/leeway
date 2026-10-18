import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessTree } from "../src/process-tree.ts";
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
        const { home, ports } = claimedFolder();
        const orphanPort = (ports.PORT_API ?? 0) + 100;
        const server = await startServer(orphanPort);

        const result = LeewayCli.run(["kill", String(orphanPort)], home, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`leeway: orphan port ${orphanPort}\n  pid ${server.pid}  ${orphanPort}  killed\n`);
        expect(await accepts(orphanPort)).toBe(false);
    }, 60_000);

    it("kills only the listener on an orphan port, leaving the leeway run above it", async () => {
        const { dir, home, ports } = claimedFolder();
        const orphanPort = (ports.PORT_API ?? 0) + 100;
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

    it("kills the range holding a given port from any folder", async () => {
        const { home, ports } = claimedFolder();
        const server = await startServer(ports.PORT_WEB);

        const result = LeewayCli.run(["kill", String(ports.PORT_API)], home, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`pid ${server.pid}  PORT_WEB ${ports.PORT_WEB}  killed`);
        expect(await accepts(ports.PORT_WEB)).toBe(false);
    }, 60_000);

    it("says so when nothing listens in the range", () => {
        const { dir, home, ports } = claimedFolder();

        const result = LeewayCli.run(["kill"], dir, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`leeway: nothing is listening in ${shown(dir)}  ${ports.PORT_WEB}-${ports.PORT_API}\n`);
    }, 60_000);
});

function claimedFolder(): { dir: string; home: string; ports: Record<string, number> } {
    const { dir, home } = LeewayCli.folder();
    const ports = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);

    return { dir, home, ports };
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

function accepts(port: number | undefined): Promise<boolean> {
    return new Promise(resolve => {
        const socket = net.connect({ host: "127.0.0.1", port: port ?? 0 }, () => {
            socket.destroy();
            resolve(true);
        });

        socket.once("error", () => resolve(false));
    });
}
