import { type ChildProcess, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Pools } from "../src/pools.ts";
import { type RangeEntry, RangeRegistry } from "../src/range-registry.ts";
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
    "inherit.mjs": nestedLeeway("--inherit"),
    "nested.mjs": nestedLeeway("--"),
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
        const { dir, home, pool } = temporaryFolder();

        const first = LeewayCli.run(["env", "--export"], dir, home);
        const second = LeewayCli.run(["env", "--export"], dir, home);

        expect(first.status).toBe(0);
        expect(first.stdout).toMatch(/^(export [A-Z_][A-Z0-9_]*=\d+\n)+$/);
        expect(Object.keys(LeewayCli.exportedPorts(first.stdout))).toEqual(["PORT_WEB", "PORT_API"]);
        expect(Object.values(LeewayCli.exportedPorts(first.stdout)).filter(port => !Pools.holds([pool], port))).toEqual([]);
        expect(LeewayCli.claimedFolders(home)).toHaveLength(1);
        expect(second.stdout).toBe(first.stdout);
    });

    it("prints the pinned ports after the claimed ones, marked pinned in the table, and keeps them out of the range", () => {
        const { dir, home } = temporaryFolder();
        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify({ ...LeewayCli.config, pinned: { PORT_DB: { port: 5432 } } }));

        const result = LeewayCli.run(["env", "--export"], dir, home);
        const exported = LeewayCli.exportedPorts(result.stdout);
        const [range] = Object.values(JSON.parse(fs.readFileSync(RangeRegistry.defaultPath(home), "utf8")).folders) as RangeEntry[];

        expect(Object.keys(exported)).toEqual(["PORT_WEB", "PORT_API", "PORT_DB"]);
        expect(exported.PORT_DB).toBe(5432);
        expect(result.stderr).toMatch(/PORT_DB +5432 {2}pinned\n/);
        expect(LeewayCli.run(["env"], dir, home).stdout).toContain("PORT_DB=5432\n");
        expect(range).toEqual({
            start: exported.PORT_WEB,
            end: exported.PORT_API,
            ports: { PORT_WEB: exported.PORT_WEB, PORT_API: exported.PORT_API },
        });
    });

    it("refuses to claim when a pinned port lies inside a pool, naming it and the pool, while --default runs on it", () => {
        const { dir, home, pool } = temporaryFolder();
        const pinnedPort = pool.start + 50;
        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify({ ...LeewayCli.config, pinned: { PORT_DB: { port: pinnedPort } } }));

        const claim = LeewayCli.run(["env", "--export"], dir, home);
        const defaults = LeewayCli.run(["--default", "node", "-e", "console.log(process.env.PORT_DB)"], dir, home);

        expect(claim.status).toBe(1);
        expect(claim.stdout).toBe("");
        expect(claim.stderr).toBe(
            `leeway: pinned PORT_DB ${pinnedPort} is inside the pool ${pool.start}-${pool.end}; pin a port outside the machine's pools\n`,
        );
        expect(LeewayCli.claimedFolders(home)).toEqual([]);
        expect(defaults.stdout).toBe(`${pinnedPort}\n`);
    });

    it("warns on stderr when the range had to move since the last claim", () => {
        const { dir, home } = temporaryFolder();
        const neighbour = temporaryFolder().dir;

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
        expect(moved.stderr).not.toMatch(/PORT_\w+ moved/);
    });

    it("does not warn when the range stays put", () => {
        const { dir, home } = temporaryFolder();

        LeewayCli.run(["env", "--export"], dir, home);

        expect(LeewayCli.run(["env", "--export"], dir, home).stderr).not.toContain("moved");
    });

    it("does not warn when a port name is added in the middle of the catalogue", () => {
        const { dir, home } = temporaryFolder();

        const first = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);
        fs.writeFileSync(
            path.join(dir, "leeway.json"),
            JSON.stringify({ ports: { PORT_WEB: { port: 5173 }, PORT_NEW: { port: 8080 }, PORT_API: { port: 3001 } } }),
        );
        const grown = LeewayCli.run(["env"], dir, home);

        expect(grown.stdout).toBe(`PORT_WEB=${first.PORT_WEB}\nPORT_NEW=${first.PORT_API! + 1}\nPORT_API=${first.PORT_API}\n`);
        expect(grown.stderr).not.toContain("moved");
    });

    it("warns on stderr about each port name whose port changed while the range stayed put", () => {
        const { dir, home } = temporaryFolder();

        const first = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);
        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify({ ports: { PORT_API: { port: 3001 } } }));
        const shrunk = LeewayCli.run(["env"], dir, home);

        expect(shrunk.stdout).toBe(`PORT_API=${first.PORT_WEB}\n`);
        expect(shrunk.stderr).toContain(
            `leeway: PORT_API moved from ${first.PORT_API} to ${first.PORT_WEB}; restart anything still using the old port\n`,
        );
        expect(shrunk.stderr).not.toContain("range moved");
    });
});

describe("leeway env", () => {
    it("prints only dotenv lines of the claimed ports, in catalogue order, the same ports --export prints", () => {
        const { dir, home } = temporaryFolder();

        const plain = LeewayCli.run(["env"], dir, home);
        const exported = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);

        expect(plain.status).toBe(0);
        expect(plain.stdout).toBe(`PORT_WEB=${exported.PORT_WEB}\nPORT_API=${exported.PORT_API}\n`);
        expect(plain.stderr).toContain(`leeway: ports ${exported.PORT_WEB}-${exported.PORT_API}`);
    });

    it("prints the inherited ports under a leeway run for the same folder, without claiming", () => {
        const { dir, home } = temporaryFolder();

        const result = LeewayCli.run(["env"], dir, home, { LEEWAY_FOLDER: dir, PORT_WEB: "24000", PORT_API: "24001" });

        expect(result.stdout).toBe("PORT_WEB=24000\nPORT_API=24001\n");
        expect(LeewayCli.claimedFolders(home)).toEqual([]);
    });
});

describe("leeway <command>", () => {
    it("exits with the command's exit code", () => {
        const { dir, home } = temporaryFolder();

        expect(LeewayCli.run(["--", "node", "-e", "process.exit(7)"], dir, home).status).toBe(7);
        expect(LeewayCli.run(["node", "-e", "process.exit(0)"], dir, home).status).toBe(0);
    });

    it("gives the command the claimed ports, and its server answers on one", async () => {
        const { dir, home } = temporaryFolder();
        const leeway = startLeeway(["node", "-e", SERVER], dir, home);

        const port = await listeningPort(leeway);
        const claimed = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);

        expect(port).toBe(claimed.PORT_WEB);
        expect(await answers(port)).toBe(true);
    });

    it("hands each argument to the command exactly as given, through the shell", () => {
        const { dir, home } = temporaryFolder();
        const args = ["a&b", "%PATH%", 'say "hi"', "x^y", "dir\\", 'q\\"z', "a b", "", "(p) <|> !x! $HOME `id`"];

        const result = LeewayCli.run(["--default", "node", "-e", "console.log(JSON.stringify(process.argv.slice(1)))", ...args], dir, home);

        expect(result.stdout).toBe(`${JSON.stringify(args)}\n`);
        expect(result.status).toBe(0);
    });

    it("hands {{LEEWAY_ENV}} to the command as one argument holding every port as JSON", () => {
        const { dir, home } = temporaryFolder();

        const result = LeewayCli.run(["--default", "node", "-e", "console.log(process.argv[1])", "LEEWAY_ENV={{LEEWAY_ENV}}"], dir, home);

        expect(result.stdout).toBe(`LEEWAY_ENV=${JSON.stringify({ PORT_WEB: 5173, PORT_API: 3001 })}\n`);
        expect(result.status).toBe(0);
    });

    it("--default puts each default port in place of {{NAME}} and in the env, ignoring the environment and the agent guard", () => {
        const { dir, home } = temporaryFolder();
        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify({ ...LeewayCli.config, agentGuard: true }));

        const result = LeewayCli.run(["--default", "--", "node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, { PORT_WEB: "24000" });
        const agent = LeewayCli.run(["--default", "--", "node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, { CLAUDECODE: "1" });

        expect(result.stdout).toBe("argument 5173, env 5173 3001\n");
        expect(agent.stdout).toBe("argument 5173, env 5173 3001\n");
        expect(result.stderr).toContain("PORT_API  3001");
        expect(LeewayCli.claimedFolders(home)).toEqual([]);
    });

    it("claims the folder's range over ports already in the environment, and in an agent shell", () => {
        const { dir, home } = temporaryFolder();
        const claimed = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);
        const expected = `argument ${claimed.PORT_WEB}, env ${claimed.PORT_WEB} ${claimed.PORT_API}\n`;

        expect(LeewayCli.run(["node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, { PORT_WEB: "24000" }).stdout).toBe(expected);
        expect(LeewayCli.run(["node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, { CLAUDECODE: "1" }).stdout).toBe(expected);
    });

    it("hands pinned ports to {{NAME}}, {{LEEWAY_ENV}} and the env in every mode, the config's port unless --inherit finds one", () => {
        const { dir, home } = temporaryFolder();
        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify({ ...LeewayCli.config, pinned: { PORT_DB: { port: 5432 } } }));
        const printPinned = ["node", "-e", "console.log(process.argv[1], process.env.PORT_DB, JSON.parse(process.argv[2]).PORT_DB)"];
        const run = (mode: string[]) =>
            LeewayCli.run([...mode, "--", ...printPinned, "{{PORT_DB}}", "{{LEEWAY_ENV}}"], dir, home, { PORT_DB: "6543" }).stdout;

        expect(run([])).toBe("5432 5432 5432\n");
        expect(run(["--default"])).toBe("5432 5432 5432\n");
        expect(run(["--inherit"])).toBe("6543 6543 6543\n");
    });

    it("--inherit takes the ports from the environment, else the default ports, without claiming", () => {
        const { dir, home } = temporaryFolder();

        expect(LeewayCli.run(["--inherit", "node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, { PORT_WEB: "24000" }).stdout).toBe(
            "argument 24000, env 24000 3001\n",
        );
        expect(LeewayCli.run(["--inherit", "node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home).stdout).toBe(
            "argument 5173, env 5173 3001\n",
        );
        expect(LeewayCli.claimedFolders(home)).toEqual([]);
    });

    it("a nested claim for the same folder runs on the outer call's ports, claimed or default, without a second table", () => {
        const { dir, home } = temporaryFolder();
        const claimed = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);

        const underClaim = LeewayCli.run(["node", "nested.mjs"], dir, home);
        const underDefault = LeewayCli.run(["--default", "node", "nested.mjs"], dir, home);

        expect(underClaim.stdout).toBe(`argument ${claimed.PORT_WEB}, env ${claimed.PORT_WEB} ${claimed.PORT_API}\n`);
        expect(underClaim.stderr.match(/^leeway: /gm)).toHaveLength(1);
        expect(underDefault.stdout).toBe("argument 5173, env 5173 3001\n");
        expect(underDefault.stderr.match(/^leeway: /gm)).toHaveLength(1);
    });

    it("claims under another folder's leeway call", () => {
        const { dir, home } = temporaryFolder();
        const claimed = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);
        const outer = { LEEWAY_FOLDER: temporaryFolder().dir, PORT_WEB: "24000", PORT_API: "24001" };

        const result = LeewayCli.run(["node", "-e", PRINT_PORTS, "{{PORT_WEB}}"], dir, home, outer);

        expect(result.stdout).toBe(`argument ${claimed.PORT_WEB}, env ${claimed.PORT_WEB} ${claimed.PORT_API}\n`);
        expect(result.stderr).toContain(`leeway: ports ${claimed.PORT_WEB}-${claimed.PORT_API}`);
    });

    it("--inherit in a nested call follows the outer call's ports, claimed or default", () => {
        const { dir, home } = temporaryFolder();
        const claimed = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);

        expect(LeewayCli.run(["node", "inherit.mjs"], dir, home).stdout).toBe(
            `argument ${claimed.PORT_WEB}, env ${claimed.PORT_WEB} ${claimed.PORT_API}\n`,
        );
        expect(LeewayCli.run(["--default", "node", "inherit.mjs"], dir, home).stdout).toBe("argument 5173, env 5173 3001\n");
    });
});

describe("leeway env --export from separate processes at once", () => {
    it("gives each folder its own range in the pool, keeps every claim in the registry, and the same range on the next claim", async () => {
        const { home, pool } = LeewayCli.folder();
        const dirs = Array.from({ length: 8 }, () => LeewayCli.folder().dir);

        const results = await Promise.all(dirs.map(dir => finished(LeewayCli.start(["env", "--export"], dir, home))));
        const ranges = results.map(({ stdout }) => Object.values(LeewayCli.exportedPorts(stdout)));

        expect(results.map(({ code }) => code)).toEqual(dirs.map(() => 0));
        expect(ranges.flat().filter(port => !Pools.holds([pool], port))).toEqual([]);
        expect(new Set(ranges.flat()).size).toBe(ranges.flat().length);
        expect(LeewayCli.claimedFolders(home)).toHaveLength(dirs.length);
        dirs.forEach((dir, index) => expect(LeewayCli.run(["env", "--export"], dir, home).stdout).toBe(results[index]!.stdout));
    }, 60_000);
});

describe("leeway pools", () => {
    it("shows the default pool, sets pools that the next claim places the range in, and resets to the default pool", () => {
        const { dir } = temporaryFolder();
        const home = LeewayCli.temporaryDir("leeway-home-");

        const before = LeewayCli.run(["pools"], dir, home);
        const set = LeewayCli.run(["pools", "set", "41000-41999", "40000-40999"], dir, home);
        const ports = LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout);
        const whileSet = LeewayCli.run(["pools"], dir, home);
        const reset = LeewayCli.run(["pools", "reset"], dir, home);
        const after = LeewayCli.run(["pools"], dir, home);

        expect(before.stdout).toBe("21000-29999 (the default pool)\n");
        expect(set.stdout).toBe("41000-41999\n40000-40999\n");
        Object.values(ports).forEach(port => {
            expect(port).toBeGreaterThanOrEqual(41000);
            expect(port).toBeLessThanOrEqual(41999);
        });
        expect(whileSet.stdout).toBe("41000-41999\n40000-40999\n");
        expect(reset.stdout).toBe("21000-29999 (the default pool)\n");
        expect(after.stdout).toBe("21000-29999 (the default pool)\n");
        expect([before, set, whileSet, reset, after].map(result => result.status)).toEqual([0, 0, 0, 0, 0]);
    });

    it("refuses pools it cannot read from the arguments, and writes nothing", () => {
        const { dir, home } = temporaryFolder();
        const before = fs.readFileSync(RangeRegistry.defaultPath(home), "utf8");

        [
            ["pools", "set"],
            ["pools", "set", "41999-41000"],
            ["pools", "set", "41000-41999", "41500-42500"],
            ["pools", "set", "web"],
        ].forEach(args => {
            const result = LeewayCli.run(args, dir, home);

            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(/^leeway: /);
        });
        expect(fs.readFileSync(RangeRegistry.defaultPath(home), "utf8")).toBe(before);
    });

    it("fails with a message to fix the pools when the registry's pools are unreadable", () => {
        const { dir, home } = temporaryFolder();
        fs.writeFileSync(RangeRegistry.defaultPath(home), JSON.stringify({ version: 1, pools: "41000-41999", folders: {} }));

        [["pools"], ["env", "--export"]].forEach(args => {
            const result = LeewayCli.run(args, dir, home);

            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
            expect(result.stderr).toMatch(/^leeway: the pools in .*; fix it/);
        });
    });

    it("runs a command named pools after --", () => {
        const { dir, home } = temporaryFolder();
        const script = process.platform === "win32" ? "pools.cmd" : "pools";
        fs.writeFileSync(path.join(dir, script), process.platform === "win32" ? "@echo ran pools\r\n" : "#!/bin/sh\necho ran pools\n", {
            mode: 0o755,
        });
        const pathName = Object.keys(process.env).find(name => name.toUpperCase() === "PATH") ?? "PATH";

        const result = LeewayCli.run(["--", "pools"], dir, home, { [pathName]: `${dir}${path.delimiter}${process.env[pathName]}` });

        expect(result.stdout.trim()).toBe("ran pools");
        expect(result.status).toBe(0);
    });
});

describe("leeway errors", () => {
    it("prints the usage and fails on a missing command, two modes or a misused subcommand", () => {
        const { dir, home } = temporaryFolder();

        [
            [],
            ["--default"],
            ["--default", "--inherit", "vite"],
            ["env", "--json"],
            ["env", "--export", "now"],
            ["list", "all"],
            ["kill", "web"],
            ["pools", "clear"],
            ["pools", "reset", "now"],
            ["release", "a", "b"],
            ["release", "--json"],
        ].forEach(args => {
            const result = LeewayCli.run(args, dir, home);

            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(/^usage: leeway \[--default \| --inherit\]/);
        });
    });

    it("prints the usage on stdout for --help and -h, and the version for --version, without claiming", () => {
        const { dir, home } = temporaryFolder();
        const version = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version;

        ["--help", "-h"].forEach(flag => {
            const result = LeewayCli.run([flag], dir, home);

            expect(result.status).toBe(0);
            expect(result.stdout).toMatch(/^usage: leeway \[--default \| --inherit\]/);
        });
        expect(LeewayCli.run(["--version"], dir, home).stdout).toBe(`${version}\n`);
        expect(LeewayCli.claimedFolders(home)).toEqual([]);
    });

    it("prints the usage and fails on a flag it does not know before the command, without claiming or running", () => {
        const { dir, home } = temporaryFolder();

        [["--foo"], ["--watch", "node", "-e", "console.log('ran')"], ["--default", "-v"]].forEach(args => {
            const result = LeewayCli.run(args, dir, home);

            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
            expect(result.stderr).toMatch(/^usage: leeway /);
        });
        expect(LeewayCli.claimedFolders(home)).toEqual([]);
    });

    it("fails on a {{NAME}} that is not a port name of the config, naming it and the port names, without claiming or running", () => {
        const { dir, home } = temporaryFolder();
        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify({ ...LeewayCli.config, pinned: { PORT_DB: { port: 5432 } } }));

        const result = LeewayCli.run(["node", "-e", "console.log(process.argv[1])", "{{PORT_WBE}}"], dir, home);

        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("leeway: unknown {{PORT_WBE}} in the command; the config has PORT_WEB, PORT_API, PORT_DB\n");
        expect(LeewayCli.claimedFolders(home)).toEqual([]);
    });

    it("--inherit gives an agent shell without ports the default ports, unless the config turns the agent guard on", () => {
        const { dir, home } = temporaryFolder();
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
        const { dir, home } = temporaryFolder();
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
        const { dir, home } = temporaryFolder();
        const port = Number(LeewayCli.exportedPorts(LeewayCli.run(["env", "--export"], dir, home).stdout).PORT_WEB);
        const pid = LeewayCli.startInOwnConsole(["node", "ctrl-c-ignoring-server.mjs"], dir, home);

        ownConsoleLeeways.push({ pid, dir });

        expect(await startsAnswering(port)).toBe(true);

        expect(LeewayCli.pressCtrlC(pid)).toBe(0);

        expect(await stopsAnswering(port)).toBe(true);
    }, 30_000);
});

function nestedLeeway(flag: string): string {
    return `import { spawnSync } from "node:child_process";
const args = [${JSON.stringify(LeewayCli.cliPath)}, "${flag}", "node", "-e", ${JSON.stringify(PRINT_PORTS)}, "{{PORT_WEB}}"];
process.exit(spawnSync(process.execPath, args, { stdio: "inherit" }).status ?? 1);
`;
}

function temporaryFolder() {
    const folder = LeewayCli.folder();

    Object.entries(FIXTURES).forEach(([name, source]) => fs.writeFileSync(path.join(folder.dir, name), source));

    return folder;
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

function finished(leeway: ChildProcess): Promise<{ code: number | null; stdout: string }> {
    let stdout = "";

    leeway.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));

    return new Promise(resolve => leeway.once("close", code => resolve({ code, stdout })));
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
