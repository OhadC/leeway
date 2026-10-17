export type ExecMode = "claim" | "defaults";

export type ExecRequest = {
    mode: ExecMode;
    command: readonly string[];
};

const SAFE_ARGUMENT = /^[\w\-+=.,/:@%{}]+$/;

export class ExecCommand {
    static requestOf(args: readonly string[]): ExecRequest | undefined {
        const mode = args[0] === "--defaults" ? "defaults" : "claim";
        const rest = mode === "defaults" ? args.slice(1) : args;
        const command = rest[0] === "--" ? rest.slice(1) : rest;

        return command.length > 0 ? { mode, command } : undefined;
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
