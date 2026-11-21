import { spawn } from "node:child_process";
import os from "node:os";
import { ProcessTree } from "./process-tree.ts";

const WINDOWS_STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGBREAK", "SIGHUP"];

const POSIX_FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGWINCH"];

export class RunWithPorts {
    static runAndExit(commandLine: string, env: Record<string, string | number>): void {
        const isWindows = process.platform === "win32";

        RunWithPorts.overrideInheritedEnv(env);

        const child = spawn(commandLine, { stdio: "inherit", shell: true, detached: !isWindows });
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

        child.on("exit", (code, signal) => process.exit(signal ? RunWithPorts.signalExitCode(signal) : (code ?? 1)));
    }

    private static overrideInheritedEnv(env: Record<string, string | number>): void {
        for (const [name, value] of Object.entries(env)) {
            process.env[name] = String(value);
        }
    }

    private static signalExitCode(signal: NodeJS.Signals): number {
        const signalNumber: number | undefined = os.constants.signals[signal];

        return signalNumber === undefined ? 1 : 128 + signalNumber;
    }
}
