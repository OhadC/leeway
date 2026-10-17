export type ExecMode = "auto" | "claim" | "defaults";

export type ExecRequest = {
    mode: ExecMode;
    command: readonly string[];
};

const MODE_FLAGS = new Map<string | undefined, ExecMode>([
    ["--claim", "claim"],
    ["--defaults", "defaults"],
]);

const SAFE_ARGUMENT = /^[\w\-+=.,/:@%{}]+$/;

export class ExecCommand {
    static requestOf(args: readonly string[]): ExecRequest | undefined {
        const flagMode = MODE_FLAGS.get(args[0]);
        const rest = flagMode ? args.slice(1) : args;
        const command = rest[0] === "--" ? rest.slice(1) : rest;

        if (flagMode && MODE_FLAGS.has(rest[0])) {
            return undefined;
        }

        return command.length > 0 ? { mode: flagMode ?? "auto", command } : undefined;
    }

    static commandLine(command: readonly string[], ports: Record<string, number>, platform: NodeJS.Platform = process.platform): string {
        const args = command.map(arg => withPorts(arg, ports));

        return args.length === 1 ? (args[0] ?? "") : args.map(arg => ExecCommand.quoted(arg, platform)).join(" ");
    }

    private static quoted(arg: string, platform: NodeJS.Platform): string {
        if (SAFE_ARGUMENT.test(arg)) {
            return arg;
        }

        return platform === "win32" ? `"${arg.replaceAll('"', '\\"')}"` : `'${arg.replaceAll("'", "'\\''")}'`;
    }
}

function withPorts(arg: string, ports: Record<string, number>): string {
    return Object.entries(ports).reduce((line, [name, port]) => line.replaceAll(`{{${name}}}`, String(port)), arg);
}
