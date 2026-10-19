export type ExecMode = "claim" | "default" | "inherit";

export type ExecRequest = {
    mode: ExecMode;
    command: readonly string[];
};

const MODE_FLAGS = new Map<string | undefined, ExecMode>([
    ["--default", "default"],
    ["--inherit", "inherit"],
]);

const SAFE_ARGUMENT = /^[\w\-+=.,/:@]+$/;

const PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

const CMD_METACHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

export class ExecCommand {
    static readonly ALL_PORTS_PLACEHOLDER = "{{LEEWAY_ENV}}";

    static requestOf(args: readonly string[]): ExecRequest | undefined {
        const flagMode = MODE_FLAGS.get(args[0]);
        const rest = flagMode ? args.slice(1) : args;

        if (rest[0] !== "--" && rest[0]?.startsWith("-")) {
            return undefined;
        }

        const command = rest[0] === "--" ? rest.slice(1) : rest;

        return command.length > 0 ? { mode: flagMode ?? "claim", command } : undefined;
    }

    static unknownPlaceholders(command: readonly string[], names: readonly string[]): string[] {
        const found = command.flatMap(arg =>
            [...arg.matchAll(PLACEHOLDER)].filter(match => match[0] !== ExecCommand.ALL_PORTS_PLACEHOLDER).map(match => match[1] ?? ""),
        );

        return [...new Set(found)].filter(name => !names.includes(name));
    }

    static commandLine(command: readonly string[], ports: Record<string, number>, platform: NodeJS.Platform = process.platform): string {
        if (command.length > 1) {
            return command.map(arg => ExecCommand.quoted(withPorts(arg, ports), platform)).join(" ");
        }

        const line = command[0] ?? "";

        if (line.includes(ExecCommand.ALL_PORTS_PLACEHOLDER)) {
            throw new Error(
                `leeway: ${ExecCommand.ALL_PORTS_PLACEHOLDER} needs the command as several arguments, not one shell line, so leeway can quote it`,
            );
        }

        return withPorts(line, ports);
    }

    private static quoted(arg: string, platform: NodeJS.Platform): string {
        if (SAFE_ARGUMENT.test(arg)) {
            return arg;
        }

        if (platform !== "win32") {
            return `'${arg.replaceAll("'", "'\\''")}'`;
        }

        const msvcrtQuoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;

        return msvcrtQuoted.replace(CMD_METACHARACTERS, "^$1");
    }
}

function withPorts(arg: string, ports: Record<string, number>): string {
    return arg.replace(PLACEHOLDER, (placeholder, name: string) =>
        placeholder === ExecCommand.ALL_PORTS_PLACEHOLDER ? JSON.stringify(ports) : String(ports[name] ?? placeholder),
    );
}
