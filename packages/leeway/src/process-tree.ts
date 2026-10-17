import { spawnSync } from "node:child_process";
import { type CommandRunner, OsCommand } from "./os-command.ts";

export type ProcessRow = {
    pid: number;
    parent: number;
    commandLine: string;
};

type WindowsProcess = {
    pid: number;
    parent: number;
    started: number;
    commandLine: string | null;
};

const WINDOWS_PROCESS_SCRIPT =
    "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,CommandLine | ForEach-Object { @{ pid = $_.ProcessId; parent = $_.ParentProcessId; started = $(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }); commandLine = $_.CommandLine } })";

const LEEWAY_RUN = /[\\/]leeway[\\/](?:dist[\\/]cli\.mjs|src[\\/]cli\.ts)|[\\/]\.?bin[\\/]leeway(?:\s|$)/;

export class ProcessTree {
    static killTreeQuietly(pid: number): void {
        try {
            ProcessTree.killTree(pid);
        } catch {
            return;
        }
    }

    static killTree(pid: number, platform: NodeJS.Platform = process.platform): void {
        if (platform === "win32") {
            ProcessTree.killWindowsTree(pid);
        } else {
            ProcessTree.killPosixTree(pid);
        }
    }

    static killTrees(pids: readonly number[], withRuns: boolean): Map<number, string> {
        const rows = withRuns && pids.length > 0 ? ProcessTree.rows() : [];
        const killed = new Set<number>();
        const failures = new Map<number, string>();

        pids.forEach(pid => {
            const top = ProcessTree.leewayRunOf(pid, rows) ?? pid;

            if (killed.has(top)) {
                return;
            }

            try {
                ProcessTree.killTree(top);
                [top, ...ProcessTree.pidsOfTree(top, rows)].forEach(member => killed.add(member));
            } catch (error) {
                if (ProcessTree.isRunning(top)) {
                    failures.set(pid, error instanceof Error ? error.message : String(error));
                }
            }
        });

        return failures;
    }

    static rows(platform: NodeJS.Platform = process.platform, run: CommandRunner = OsCommand.run): ProcessRow[] {
        if (platform === "win32") {
            return ProcessTree.windowsRows(OsCommand.powershell(run, WINDOWS_PROCESS_SCRIPT));
        }

        return OsCommand.output(run, "ps", ["-A", "-ww", "-o", "pid=,ppid=,args="])
            .split("\n")
            .flatMap(line => {
                const match = /^\s*(\d+)\s+(\d+) ?(.*)$/.exec(line);

                return match ? [{ pid: Number(match[1]), parent: Number(match[2]), commandLine: match[3] ?? "" }] : [];
            });
    }

    static pidsOfTree(pid: number, rows: ProcessRow[]): number[] {
        if (!rows.some(row => row.pid === pid)) {
            return [];
        }

        const tree = [pid];

        for (const member of tree) {
            tree.push(...rows.filter(row => row.parent === member && !tree.includes(row.pid)).map(row => row.pid));
        }

        return tree;
    }

    static leewayRunOf(pid: number, rows: ProcessRow[]): number | undefined {
        const byPid = new Map(rows.map(row => [row.pid, row]));
        const visited = new Set([pid]);

        for (let current = byPid.get(pid); current && !visited.has(current.parent);) {
            visited.add(current.parent);
            current = byPid.get(current.parent);

            if (current && LEEWAY_RUN.test(current.commandLine)) {
                return current.pid;
            }
        }

        return undefined;
    }

    static signalGroup(leaderPid: number, signal: NodeJS.Signals): void {
        try {
            process.kill(-leaderPid, signal);
        } catch {
            return;
        }
    }

    private static windowsRows(json: string): ProcessRow[] {
        const processes = JSON.parse(json) as WindowsProcess[];
        const started = new Map(processes.map(row => [row.pid, row.started]));

        return processes.map(row => ({
            pid: row.pid,
            parent: (started.get(row.parent) ?? Infinity) <= row.started ? row.parent : 0,
            commandLine: row.commandLine ?? "",
        }));
    }

    private static isRunning(pid: number): boolean {
        try {
            process.kill(pid, 0);

            return true;
        } catch (error) {
            return (error as NodeJS.ErrnoException).code === "EPERM";
        }
    }

    private static killWindowsTree(pid: number): void {
        const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });

        if (result.status !== 0) {
            throw new Error(result.stderr.trim() || `taskkill exited with ${result.status}`);
        }
    }

    private static killPosixTree(pid: number): void {
        const tree = ProcessTree.pidsOfTree(pid, ProcessTree.rows());

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
