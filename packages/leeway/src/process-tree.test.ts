import { spawn } from "node:child_process";
import { once } from "node:events";
import readline from "node:readline";
import { describe, expect, it, vi } from "vitest";
import { ProcessTree } from "./process-tree.ts";

const PS_TABLE = ["    1     0", "  100     1", "   50   100", "  120   100", "   30    50", "  200     1", "  201   200", ""].join("\n");

const PARENT_OF_A_SLEEPER =
    'const sleeper = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(sleeper.pid); setInterval(() => {}, 1000);';

describe("ProcessTree.pidsOfTree", () => {
    it("lists a process and its descendants from ps output, parents before children", () => {
        expect(ProcessTree.pidsOfTree(100, PS_TABLE)).toEqual([100, 50, 120, 30]);
    });

    it("lists nothing for a pid ps does not show", () => {
        expect(ProcessTree.pidsOfTree(999, PS_TABLE)).toEqual([]);
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

function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        return false;
    }
}
