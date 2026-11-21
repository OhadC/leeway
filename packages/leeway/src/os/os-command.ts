import { spawnSync } from "node:child_process";

export type CommandResult =
    | {
          status: number | null;
          stdout: string;
          stderr: string;
      }
    | { status: "not found" };

export type CommandRunner = (file: string, args: readonly string[]) => CommandResult;

const UTF8_OUTPUT = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false";

const PACKAGE_OF_TOOL: Record<string, string> = { ss: "iproute2", ps: "procps" };

export class OsCommand {
    static run(file: string, args: readonly string[]): CommandResult {
        const result = spawnSync(file, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

        if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
            return { status: "not found" };
        }

        return { status: result.status, stdout: result.stdout, stderr: result.error?.message ?? result.stderr };
    }

    static output(run: CommandRunner, file: string, args: readonly string[], fineStatuses: readonly number[] = [0]): string {
        const result = run(file, args);

        if (result.status !== "not found" && result.status !== null && fineStatuses.includes(result.status)) {
            return result.stdout;
        }

        throw new Error(OsCommand.failure(file, result));
    }

    static powershell(run: CommandRunner, script: string): string {
        return OsCommand.output(run, "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `${UTF8_OUTPUT}; ${script}`]);
    }

    private static failure(file: string, result: CommandResult): string {
        const toolPackage = PACKAGE_OF_TOOL[file];

        if (toolPackage && (result.status === "not found" || result.stderr.includes("BusyBox"))) {
            return `leeway: install ${toolPackage} for ${file}`;
        }

        const reason = result.status === "not found" ? "not found on PATH" : result.stderr.trim() || `exit status ${result.status}`;

        return `leeway: ${file} failed: ${reason}`;
    }
}
