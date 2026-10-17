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
};

const runningLeeways: ChildProcess[] = [];

afterEach(async () => {
    await Promise.all(runningLeeways.splice(0).map(stopLeeway));
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
        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify({ ...LeewayCli.catalogue, PORT_DOCS: { port: 8080 } }));
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

describe("leeway exec", () => {
    it("exits with the command's exit code", () => {
        const { dir, home } = temporaryProject();

        expect(LeewayCli.run(["exec", "--", "node", "-e", "process.exit(7)"], dir, home).status).toBe(7);
        expect(LeewayCli.run(["exec", "--claim", "--", "node", "-e", "process.exit(0)"], dir, home).status).toBe(0);
    });

    it("--claim gives the command the claimed ports, and its server answers on one", async () => {
        const { dir, home } = temporaryProject();
        const leeway = startLeeway(["exec", "--claim", "--", "node", "-e", SERVER], dir, home);

        const port = await listeningPort(leeway);
        const claimed = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);

        expect(port).toBe(claimed.PORT_WEB);
        expect(await answers(port)).toBe(true);
    });

    it("--defaults puts each default port in place of {{NAME}} and in the env, keeping stdout for the command", () => {
        const { dir, home } = temporaryProject();

        const result = LeewayCli.run(["exec", "--defaults", "--", "node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home);

        expect(result.stdout).toBe("argument 5173, env 5173 3001\n");
        expect(result.stderr).toContain("PORT_API  3001");
        expect(fs.existsSync(path.join(home, ".leeway"))).toBe(false);
    });

    it("without a flag takes the ports from the environment", () => {
        const { dir, home } = temporaryProject();

        const result = LeewayCli.run(["exec", "node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, { PORT_WEB: "24000" });

        expect(result.stdout).toBe("argument 24000, env 24000 3001\n");
    });
});

describe("leeway errors", () => {
    it("prints the usage and fails on an unknown command or an exec without a command", () => {
        const { dir, home } = temporaryProject();

        [["start"], ["exec", "--claim"], ["env"]].forEach(args => {
            const result = LeewayCli.run(args, dir, home);

            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(/^usage: leeway exec/);
        });
    });

    it("refuses default ports to an agent shell and points at --claim", () => {
        const { dir, home } = temporaryProject();

        const result = LeewayCli.run(["exec", "--", "node", "-e", "process.exit(0)"], dir, home, { CLAUDECODE: "1" });

        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/^leeway: agent shell detected.*leeway exec --claim/);
    });

    it("fails with a leeway: message outside a folder with leeway.json", () => {
        const home = LeewayCli.temporaryDir("leeway-home-");

        const result = LeewayCli.run(["env", "--export"], home, home);

        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toMatch(/^leeway: no leeway\.json in /);
    });
});

describe.skipIf(process.platform === "win32")("leeway exec on a signal", () => {
    it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)("%s stops the whole command tree, so nothing is left listening", async signal => {
        const { dir, home } = temporaryProject();
        const leeway = startLeeway(["exec", "--claim", "--", "node", "launcher.mjs"], dir, home);
        const port = await listeningPort(leeway);
        const exitCode = new Promise(resolve => leeway.once("exit", resolve));

        expect(await answers(port)).toBe(true);

        leeway.kill(signal);

        expect(await exitCode).not.toBe(0);
        expect(await stopsAnswering(port)).toBe(true);
    });
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

async function stopsAnswering(port: number): Promise<boolean> {
    for (const deadline = Date.now() + 2000; Date.now() < deadline;) {
        if (!(await answers(port))) {
            return true;
        }

        await new Promise(resolve => setTimeout(resolve, 50));
    }

    return false;
}
