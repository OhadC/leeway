import { spawnSync } from "node:child_process";

export class ProcessTree {
    static taskkill(pid: number): void {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    }

    static killTree(pid: number, platform: NodeJS.Platform = process.platform): void {
        if (platform === "win32") {
            ProcessTree.killWindowsTree(pid);
        } else {
            ProcessTree.killPosixTree(pid);
        }
    }

    static pidsOfTree(pid: number, psTable: string): number[] {
        const rows = psTable.split("\n").flatMap(line => {
            const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);

            return match ? [{ pid: Number(match[1]), parent: Number(match[2]) }] : [];
        });

        if (!rows.some(row => row.pid === pid)) {
            return [];
        }

        const tree = [pid];

        for (const member of tree) {
            tree.push(...rows.filter(row => row.parent === member && !tree.includes(row.pid)).map(row => row.pid));
        }

        return tree;
    }

    static signalGroup(leaderPid: number, signal: NodeJS.Signals): void {
        try {
            process.kill(-leaderPid, signal);
        } catch {
            return;
        }
    }

    private static killWindowsTree(pid: number): void {
        const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });

        if (result.status !== 0) {
            throw new Error(result.stderr.trim() || `taskkill exited with ${result.status}`);
        }
    }

    private static killPosixTree(pid: number): void {
        const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });

        if (ps.status !== 0) {
            throw new Error(`leeway: ps failed: ${ps.error?.message ?? ps.stderr.trim()}`);
        }

        const tree = ProcessTree.pidsOfTree(pid, ps.stdout);

        if (tree.length === 0) {
            throw new Error(`leeway: no process with pid ${pid}`);
        }

        tree.forEach(member => {
            try {
                process.kill(member, "SIGKILL");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
                    throw error;
                }
            }
        });
    }
}
