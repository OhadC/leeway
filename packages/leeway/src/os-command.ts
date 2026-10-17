import { spawnSync } from "node:child_process";

export type CommandResult = {
    status: number | null;
    stdout: string;
    stderr: string;
};

export type CommandRunner = (file: string, args: readonly string[]) => CommandResult;

export class OsCommand {
    static run(file: string, args: readonly string[]): CommandResult {
        const result = spawnSync(file, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

        return { status: result.status, stdout: result.stdout, stderr: result.error?.message ?? result.stderr };
    }

    static output(run: CommandRunner, file: string, args: readonly string[], fineStatuses: readonly number[] = [0]): string {
        const { status, stdout, stderr } = run(file, args);

        if (status === null || !fineStatuses.includes(status)) {
            throw new Error(`leeway: ${file} failed: ${stderr.trim() || `exit status ${status}`}`);
        }

        return stdout;
    }

    static powershell(run: CommandRunner, script: string): string {
        return OsCommand.output(run, "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    }
}
