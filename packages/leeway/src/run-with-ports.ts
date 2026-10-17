import { spawn } from "node:child_process";
import { ProcessTree } from "./process-tree.ts";

const WINDOWS_STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGBREAK", "SIGHUP"];

const POSIX_FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

export class RunWithPorts {
    static runAndExit(commandLine: string, ports: Record<string, number>): void {
        const isWindows = process.platform === "win32";
        const portEnv = Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, String(port)]));
        const child = spawn(commandLine, {
            stdio: "inherit",
            shell: true,
            detached: !isWindows,
            env: { ...process.env, ...portEnv },
        });
        const pid = child.pid;

        if (pid === undefined) {
            child.on("error", error => {
                process.stderr.write(`leeway: could not start ${commandLine}: ${error.message}\n`);
                process.exit(1);
            });
            return;
        }

        if (isWindows) {
            WINDOWS_STOP_SIGNALS.forEach(signal => process.on(signal, () => ProcessTree.killTreeQuietly(pid)));
        } else {
            POSIX_FORWARDED_SIGNALS.forEach(signal => process.on(signal, () => ProcessTree.signalGroup(pid, signal)));
        }

        child.on("exit", (code, signal) => {
            process.exit(signal ? 1 : (code ?? 1));
        });
    }
}
