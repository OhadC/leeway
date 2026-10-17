export type LeewayCatalogue = Record<string, { port: number }>;

export type LeewayEnv = Record<string, string | number | undefined>;

export type PortsOf<T> = Record<keyof T & string, number>;

declare const __LEEWAY_ENV__: Record<string, number> | undefined;

const AGENT_MARKERS = ["CLAUDECODE", "GEMINI_CLI", "CURSOR_AGENT", "AI_AGENT"];

export function devPorts<T extends LeewayCatalogue>(catalogue: T, env: LeewayEnv = currentEnv()): PortsOf<T> {
    if (isAgentShell(env) && !env.VITEST && !Object.keys(catalogue).some(name => env[name])) {
        throw new Error(
            "leeway: agent shell detected without leeway ports; run through `leeway exec --claim -- <command>` or `leeway env --export`",
        );
    }

    return Object.fromEntries(Object.entries(catalogue).map(([name, { port }]) => [name, configuredPort(env[name]) ?? port])) as PortsOf<T>;
}

export class DefaultPorts {
    static ports(catalogue: LeewayCatalogue): Record<string, number> {
        return Object.fromEntries(Object.entries(catalogue).map(([name, { port }]) => [name, port]));
    }
}

function configuredPort(value: string | number | undefined): number | undefined {
    const port = Number(value);

    return value !== "" && Number.isInteger(port) && port > 0 ? port : undefined;
}

function isAgentShell(env: LeewayEnv): boolean {
    return AGENT_MARKERS.some(marker => env[marker]);
}

function currentEnv(): LeewayEnv {
    const injected = typeof __LEEWAY_ENV__ === "undefined" ? {} : __LEEWAY_ENV__;
    const processEnv = typeof process === "undefined" ? {} : process.env;

    return { ...injected, ...processEnv };
}
