import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const CLI = path.join(import.meta.dirname, "..", "src", "cli.ts");

const CATALOGUE = { PORT_WEB: { port: 5173 }, PORT_API: { port: 3001 } };

const INHERITED_TO_STRIP = ["CLAUDECODE", "GEMINI_CLI", "CURSOR_AGENT", "AI_AGENT", "VITEST", ...Object.keys(CATALOGUE)];

const SERVER = 'require("node:net").createServer().listen(Number(process.argv[1]), () => console.log("listening"));';

const temporaryDirs: string[] = [];

const servers: ChildProcess[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(stopServer));
    temporaryDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
});

describe("leeway list and kill", () => {
    it("lists a server listening in the folder's range with its pid", async () => {
        const { dir, home, ports } = claimedProject();
        const server = await startServer(ports.PORT_WEB);

        const result = runLeeway(["list"], dir, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`${shown(dir)}  ${ports.PORT_WEB}-${ports.PORT_API}`);
        expect(result.stdout).toContain(`PORT_WEB  ${ports.PORT_WEB}  pid ${server.pid}`);
        expect(result.stdout).toContain(`PORT_API  ${ports.PORT_API}  -`);
    }, 60_000);

    it("kills what listens in the current folder's range", async () => {
        const { dir, home, ports } = claimedProject();
        const server = await startServer(ports.PORT_WEB);

        const result = runLeeway(["kill"], dir, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`pid ${server.pid}  PORT_WEB ${ports.PORT_WEB}  killed`);
        expect(await accepts(ports.PORT_WEB)).toBe(false);
    }, 60_000);

    it("kills the range holding a given port from any folder", async () => {
        const { home, ports } = claimedProject();
        const server = await startServer(ports.PORT_WEB);

        const result = runLeeway(["kill", String(ports.PORT_API)], home, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`pid ${server.pid}  PORT_WEB ${ports.PORT_WEB}  killed`);
        expect(await accepts(ports.PORT_WEB)).toBe(false);
    }, 60_000);

    it("says so when nothing listens in the range", () => {
        const { dir, home, ports } = claimedProject();

        const result = runLeeway(["kill"], dir, home);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`leeway: nothing is listening in ${shown(dir)}  ${ports.PORT_WEB}-${ports.PORT_API}\n`);
    }, 60_000);
});

function claimedProject(): { dir: string; home: string; ports: Record<string, number> } {
    const dir = temporaryDir("leeway-project-");
    const home = temporaryDir("leeway-home-");

    fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify(CATALOGUE));

    const claimed = runLeeway(["env", "--export"], dir, home);
    const ports = Object.fromEntries(
        claimed.stdout
            .trim()
            .split("\n")
            .map(line => line.replace("export ", "").split("="))
            .map(([name, port]) => [name, Number(port)]),
    );

    return { dir, home, ports };
}

function shown(dir: string): string {
    return process.platform === "win32" ? dir.toLowerCase() : dir;
}

function temporaryDir(prefix: string): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

    temporaryDirs.push(dir);

    return dir;
}

function runLeeway(args: string[], cwd: string, home: string) {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };

    INHERITED_TO_STRIP.forEach(name => delete env[name]);

    return spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8" });
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

    server.kill();
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
