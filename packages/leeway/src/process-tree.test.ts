import { spawn } from "node:child_process";
import { once } from "node:events";
import readline from "node:readline";
import { describe, expect, it, vi } from "vitest";
import type { CommandRunner } from "./os-command.ts";
import { type ProcessRow, ProcessTree } from "./process-tree.ts";

const PS_TABLE = [
    "    1     0 /sbin/init",
    "  100     1 node /home/me/app/node_modules/leeway/dist/cli.mjs tsx watch src/main.ts",
    "   50   100 sh -c tsx watch src/main.ts",
    "  120   100 ",
    "   30    50 node /home/me/app/node_modules/tsx/dist/cli.mjs watch src/main.ts",
    "   31    30 node --inspect=21001 src/main.ts",
    "  200     1 node /home/me/other/node_modules/leeway/dist/cli.mjs vite",
    "  201   200 node /home/me/other/node_modules/vite/bin/vite.js",
    "",
].join("\n");

const WINDOWS_LEEWAY = String.raw`"C:\Program Files\nodejs\node.exe" C:\app\node_modules\leeway\dist\cli.mjs tsx watch`;

const WINDOWS_JSON = JSON.stringify([
    { pid: 4, parent: 0, started: 1000, commandLine: null },
    { pid: 700, parent: 4, started: 2000, commandLine: WINDOWS_LEEWAY },
    { pid: 710, parent: 700, started: 2000, commandLine: "cmd.exe /d /s /c tsx watch" },
    { pid: 720, parent: 9999, started: 3000, commandLine: "node server.js" },
    { pid: 730, parent: 740, started: 3000, commandLine: "node server.js" },
    { pid: 740, parent: 4, started: 4000, commandLine: String.raw`node C:\other\node_modules\leeway\dist\cli.mjs vite` },
]);

const PARENT_OF_A_SLEEPER =
    'const sleeper = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(sleeper.pid); setInterval(() => {}, 1000);';

describe("ProcessTree.rows", () => {
    it("reads pid, parent and command line from ps output", () => {
        expect(psRows().slice(1, 4)).toEqual([
            { pid: 100, parent: 1, commandLine: "node /home/me/app/node_modules/leeway/dist/cli.mjs tsx watch src/main.ts" },
            { pid: 50, parent: 100, commandLine: "sh -c tsx watch src/main.ts" },
            { pid: 120, parent: 100, commandLine: "" },
        ]);
    });

    it("reads windows processes, dropping a parent pid that is gone or was reused by a later process", () => {
        expect(windowsRows()).toEqual([
            { pid: 4, parent: 0, commandLine: "" },
            { pid: 700, parent: 4, commandLine: WINDOWS_LEEWAY },
            { pid: 710, parent: 700, commandLine: "cmd.exe /d /s /c tsx watch" },
            { pid: 720, parent: 0, commandLine: "node server.js" },
            { pid: 730, parent: 0, commandLine: "node server.js" },
            { pid: 740, parent: 4, commandLine: String.raw`node C:\other\node_modules\leeway\dist\cli.mjs vite` },
        ]);
    });
});

describe("ProcessTree.pidsOfTree", () => {
    it("lists a process and its descendants, parents before children", () => {
        expect(ProcessTree.pidsOfTree(100, psRows())).toEqual([100, 50, 120, 30, 31]);
    });

    it("lists nothing for a pid that is not running", () => {
        expect(ProcessTree.pidsOfTree(999, psRows())).toEqual([]);
    });
});

describe("ProcessTree.leewayRunOf", () => {
    it("finds the nearest leeway run above a process, past the watcher that restarts it", () => {
        expect(ProcessTree.leewayRunOf(31, psRows())).toBe(100);
        expect(ProcessTree.leewayRunOf(201, psRows())).toBe(200);
        expect(ProcessTree.leewayRunOf(710, windowsRows())).toBe(700);
    });

    it("finds the inner run of nested leeway runs", () => {
        const rows: ProcessRow[] = [
            ...psRows(),
            { pid: 300, parent: 31, commandLine: String.raw`node C:\app\packages\leeway\src\cli.ts vite` },
            { pid: 301, parent: 300, commandLine: "node vite.js" },
        ];

        expect(ProcessTree.leewayRunOf(301, rows)).toBe(300);
    });

    it("finds none for a process not started under leeway, for a run at the top, or across a reused parent pid", () => {
        expect(ProcessTree.leewayRunOf(1, psRows())).toBeUndefined();
        expect(ProcessTree.leewayRunOf(100, psRows())).toBeUndefined();
        expect(ProcessTree.leewayRunOf(730, windowsRows())).toBeUndefined();
    });

    it("stops on a parent loop", () => {
        const rows: ProcessRow[] = [
            { pid: 1, parent: 2, commandLine: "a" },
            { pid: 2, parent: 1, commandLine: "b" },
        ];

        expect(ProcessTree.leewayRunOf(1, rows)).toBeUndefined();
    });
});

describe("ProcessTree.killTree", () => {
    it("ends a running process together with its descendants", async () => {
        const parent = spawn(process.execPath, ["-e", PARENT_OF_A_SLEEPER], { stdio: ["ignore", "pipe", "inherit"] });
        const exited = new Promise(resolve => parent.once("exit", resolve));
        const [line] = await once(readline.createInterface({ input: parent.stdout }), "line");
        const sleeperPid = Number(line);

        try {
            ProcessTree.killTree(parent.pid ?? 0);

            await expect(exited).resolves.not.toBe(0);
            await vi.waitFor(() => expect(isRunning(sleeperPid)).toBe(false), { timeout: 5_000 });
        } finally {
            [parent.pid ?? 0, sleeperPid].filter(pid => pid > 0 && isRunning(pid)).forEach(pid => process.kill(pid));
        }
    }, 15_000);

    it("throws why a process could not be killed", () => {
        expect(() => ProcessTree.killTree(999_999_999)).toThrow(/999999999/);
    });
});

function psRows(): ProcessRow[] {
    return ProcessTree.rows("linux", printed(PS_TABLE));
}

function windowsRows(): ProcessRow[] {
    return ProcessTree.rows("win32", printed(WINDOWS_JSON));
}

function printed(stdout: string): CommandRunner {
    return () => ({ status: 0, stdout, stderr: "" });
}

function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        return false;
    }
}
