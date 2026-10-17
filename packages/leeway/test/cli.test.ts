import { type ChildProcess, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LeewayCli } from "./leeway-cli.ts";

const SERVER =
    "require('node:http').createServer((q, s) => s.end('ok')).listen(process.env.PORT_WEB, () => console.log('listening ' + process.env.PORT_WEB))";

const PRINT_PORTS = "console.log('argument ' + process.argv[1] + ', env ' + process.env.PORT_WEB + ' ' + process.env.PORT_API)";

const FIXTURES = {
    "launcher.mjs": `import { spawn } from "node:child_process";
spawn(process.execPath, ["-e", ${JSON.stringify(SERVER)}], { stdio: "inherit" });
`,
    "ctrl-c-ignoring-server.mjs": `import fs from "node:fs";
import http from "node:http";
fs.writeFileSync("server.pid", String(process.pid));
process.on("SIGINT", () => {});
http.createServer((request, response) => response.end("ok")).listen(process.env.PORT_WEB);
`,
    "inherit.mjs": `import { spawnSync } from "node:child_process";
const args = [${JSON.stringify(LeewayCli.cliPath)}, "--inherit", "node", "-e", ${JSON.stringify(PRINT_PORTS)}, "{{PORT_WEB}}"];
process.exit(spawnSync(process.execPath, args, { stdio: "inherit" }).status ?? 1);
`,
};

const runningLeeways: ChildProcess[] = [];

const ownConsoleLeeways: { pid: number; dir: string }[] = [];

afterEach(async () => {
    await Promise.all(runningLeeways.splice(0).map(stopLeeway));
    ownConsoleLeeways.splice(0).forEach(stopOwnConsoleLeeway);
    LeewayCli.removeTemporaryDirs();
});

describe("leeway env --export", () => {
    it("prints only export lines of ports claimed in the pool, and the same ports on the next call", () => {
        const { dir, home } = temporaryProject();

        const first = LeewayCli.run(["env", "--export"], dir, home);
        const second = LeewayCli.run(["env", "--export"], dir, home);

        expect(first.status).toBe(0);
        expect(first.stdout).toMatch(/^(export [A-Z_][A-Z0-9_]*=\d+\n)+$/);
        expect(Object.keys(LeewayCli.exportedPorts(first.stdout))).toEqual(["PORT_WEB", "PORT_API"]);
        Object.values(LeewayCli.exportedPorts(first.stdout)).forEach(port => {
            expect(port).toBeGreaterThanOrEqual(21000);
            expect(port).toBeLessThanOrEqual(29999);
        });
        expect(fs.existsSync(path.join(home, ".leeway", "ranges.json"))).toBe(true);
        expect(second.stdout).toBe(first.stdout);
    });

    it("warns on stderr when the range had to move since the last claim", () => {
        const { dir, home } = temporaryProject();
        const neighbour = temporaryProject().dir;

        const first = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);
        LeewayCli.run(["env", "--export"], neighbour, home);
        fs.writeFileSync(
            path.join(dir, "leeway.json"),
            JSON.stringify({ ports: { ...LeewayCli.config.ports, PORT_DOCS: { port: 8080 } } }),
        );
        const moved = LeewayCli.run(["env", "--export"], dir, home);

        expect(moved.stdout).toMatch(/^(export [A-Z_][A-Z0-9_]*=\d+\n){3}$/);
        expect(LeewayCli.exportedPorts(moved.stdout).PORT_WEB).not.toBe(first.PORT_WEB);
        expect(moved.stderr).toContain(`range moved from ${first.PORT_WEB}-${first.PORT_API}`);
    });

    it("does not warn when the range stays put", () => {
        const { dir, home } = temporaryProject();

        LeewayCli.run(["env", "--export"], dir, home);

        expect(LeewayCli.run(["env", "--export"], dir, home).stderr).not.toContain("moved");
    });
});

describe("leeway <command>", () => {
    it("exits with the command's exit code", () => {
        const { dir, home } = temporaryProject();

        expect(LeewayCli.run(["--", "node", "-e", "process.exit(7)"], dir, home).status).toBe(7);
        expect(LeewayCli.run(["node", "-e", "process.exit(0)"], dir, home).status).toBe(0);
    });

    it("gives the command the claimed ports, and its server answers on one", async () => {
        const { dir, home } = temporaryProject();
        const leeway = startLeeway(["node", "-e", SERVER], dir, home);

        const port = await listeningPort(leeway);
        const claimed = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);

        expect(port).toBe(claimed.PORT_WEB);
        expect(await answers(port)).toBe(true);
    });

    it("--default puts each default port in place of {{NAME}} and in the env, ignoring the environment and the agent guard", () => {
        const { dir, home } = temporaryProject();
        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify({ ...LeewayCli.config, agentGuard: true }));

        const result = LeewayCli.run(["--default", "--", "node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, { PORT_WEB: "24000" });
        const agent = LeewayCli.run(["--default", "--", "node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, { CLAUDECODE: "1" });

        expect(result.stdout).toBe("argument 5173, env 5173 3001\n");
        expect(agent.stdout).toBe("argument 5173, env 5173 3001\n");
        expect(result.stderr).toContain("PORT_API  3001");
        expect(fs.existsSync(path.join(home, ".leeway"))).toBe(false);
    });

    it("claims the folder's range over ports already in the environment, and in an agent shell", () => {
        const { dir, home } = temporaryProject();
        const claimed = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);
        const expected = `argument ${claimed.PORT_WEB}, env ${claimed.PORT_WEB} ${claimed.PORT_API}\n`;

        expect(LeewayCli.run(["node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, { PORT_WEB: "24000" }).stdout).toBe(expected);
        expect(LeewayCli.run(["node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, { CLAUDECODE: "1" }).stdout).toBe(expected);
    });

    it("--inherit takes the ports from the environment, else the default ports, without claiming", () => {
        const { dir, home } = temporaryProject();

        expect(LeewayCli.run(["--inherit", "node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, { PORT_WEB: "24000" }).stdout).toBe(
            "argument 24000, env 24000 3001\n",
        );
        expect(LeewayCli.run(["--inherit", "node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home).stdout).toBe(
            "argument 5173, env 5173 3001\n",
        );
        expect(fs.existsSync(path.join(home, ".leeway"))).toBe(false);
    });

    it("--inherit in a nested call follows the outer call's ports, claimed or default", () => {
        const { dir, home } = temporaryProject();
        const claimed = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);

        expect(LeewayCli.run(["node", "inherit.mjs"], dir, home).stdout).toBe(
            `argument ${claimed.PORT_WEB}, env ${claimed.PORT_WEB} ${claimed.PORT_API}\n`,
        );
        expect(LeewayCli.run(["--default", "node", "inherit.mjs"], dir, home).stdout).toBe("argument 5173, env 5173 3001\n");
    });
});

describe("leeway errors", () => {
    it("prints the usage and fails on a missing command, two modes or a misused subcommand", () => {
        const { dir, home } = temporaryProject();

        [[], ["--default"], ["--default", "--inherit", "vite"], ["env"], ["list", "all"], ["kill", "web"]].forEach(args => {
            const result = LeewayCli.run(args, dir, home);

            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(/^usage: leeway \[--default \| --inherit\]/);
        });
    });

    it("--inherit gives an agent shell without ports the default ports, unless the config turns the agent guard on", () => {
        const { dir, home } = temporaryProject();
        const inherit = ["--inherit", "node", "-e", PRINT_PORTS, "{{PORT_WEB}}"];

        expect(LeewayCli.run(inherit, dir, home, { CLAUDECODE: "1" }).stdout).toBe("argument 5173, env 5173 3001\n");

        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify({ ...LeewayCli.config, agentGuard: true }));
        const guarded = LeewayCli.run(inherit, dir, home, { CLAUDECODE: "1" });

        expect(guarded.status).toBe(1);
        expect(guarded.stderr).toMatch(/^leeway: agent shell detected/);
    });

    it("fails with a leeway: message outside a folder with leeway.json", () => {
        const home = LeewayCli.temporaryDir("leeway-home-");

        const result = LeewayCli.run(["env", "--export"], home, home);

        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toMatch(/^leeway: no leeway\.json in /);
    });
});

describe.skipIf(process.platform === "win32")("leeway <command> on a signal", () => {
    it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)("%s stops the whole command tree, so nothing is left listening", async signal => {
        const { dir, home } = temporaryProject();
        const leeway = startLeeway(["node", "launcher.mjs"], dir, home);
        const port = await listeningPort(leeway);
        const exitCode = new Promise(resolve => leeway.once("exit", resolve));

        expect(await answers(port)).toBe(true);

        leeway.kill(signal);

        expect(await exitCode).not.toBe(0);
        expect(await stopsAnswering(port)).toBe(true);
    });
});

describe.runIf(process.platform === "win32")("leeway <command> on Ctrl+C in its console", () => {
    it("stops the whole command tree, even a server that ignores Ctrl+C, so nothing is left listening", async () => {
        const { dir, home } = temporaryProject();
        const port = Number(LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout).PORT_WEB);
        const pid = LeewayCli.startInOwnConsole(["node", "ctrl-c-ignoring-server.mjs"], dir, home);

        ownConsoleLeeways.push({ pid, dir });

        expect(await startsAnswering(port)).toBe(true);

        expect(LeewayCli.pressCtrlC(pid)).toBe(0);

        expect(await stopsAnswering(port)).toBe(true);
    }, 30_000);
});

function temporaryProject(): { dir: string; home: string } {
    const project = LeewayCli.project();

    Object.entries(FIXTURES).forEach(([name, source]) => fs.writeFileSync(path.join(project.dir, name), source));

    return project;
}

function startLeeway(args: string[], cwd: string, home: string): ChildProcess {
    const leeway = LeewayCli.start(args, cwd, home);

    runningLeeways.push(leeway);

    return leeway;
}

async function stopLeeway(leeway: ChildProcess): Promise<void> {
    if (leeway.exitCode !== null || leeway.signalCode !== null) {
        return;
    }

    const exited = new Promise(resolve => leeway.once("exit", resolve));

    if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(leeway.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
        leeway.kill("SIGTERM");
    }

    await exited;
}

function stopOwnConsoleLeeway({ pid, dir }: { pid: number; dir: string }): void {
    const serverPid = path.join(dir, "server.pid");

    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });

    if (fs.existsSync(serverPid)) {
        spawnSync("taskkill", ["/PID", fs.readFileSync(serverPid, "utf8"), "/F"], { stdio: "ignore" });
    }
}

function listeningPort(leeway: ChildProcess): Promise<number> {
    return new Promise((resolve, reject) => {
        let output = "";

        leeway.stdout?.on("data", (chunk: Buffer) => {
            output += chunk.toString();
            const port = /listening (\d+)/.exec(output)?.[1];

            if (port) {
                resolve(Number(port));
            }
        });
        leeway.on("exit", code => reject(new Error(`leeway exited with ${code} before listening: ${output}`)));
    });
}

function answers(port: number): Promise<boolean> {
    return new Promise(resolve => {
        http.get({ host: "127.0.0.1", port, timeout: 1000 }, response => resolve(response.statusCode === 200))
            .on("error", () => resolve(false))
            .on("timeout", () => resolve(false));
    });
}

function startsAnswering(port: number): Promise<boolean> {
    return reachesAnswering(port, true, 10_000);
}

function stopsAnswering(port: number): Promise<boolean> {
    return reachesAnswering(port, false, 2000);
}

async function reachesAnswering(port: number, answering: boolean, timeoutMs: number): Promise<boolean> {
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
        if ((await answers(port)) === answering) {
            return true;
        }

        await new Promise(resolve => setTimeout(resolve, 50));
    }

    return false;
}
