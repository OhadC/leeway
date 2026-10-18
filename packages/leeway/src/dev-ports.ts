export type LeewayCatalogue = Record<string, { port: number }>;

export type LeewayConfig = {
    ports: LeewayCatalogue;
    agentGuard?: boolean;
};

export type LeewayEnv = Record<string, string | number | undefined>;

export type PortsOf<T extends LeewayConfig> = Record<keyof T["ports"] & string, number>;

declare const __LEEWAY_ENV__: Record<string, number> | undefined;

const AGENT_MARKERS = ["CLAUDECODE", "GEMINI_CLI", "CURSOR_AGENT", "AI_AGENT"];

export function devPorts<T extends LeewayConfig>(config: T, env: LeewayEnv = currentEnv()): PortsOf<T> {
    const catalogue = config.ports;

    if (config.agentGuard && isAgentShell(env) && !env.VITEST && !Object.keys(catalogue).some(name => env[name])) {
        throw new Error("leeway: agent shell detected without leeway ports; run through `leeway <command>` or `leeway env --export`");
    }

    return Object.fromEntries(Object.entries(catalogue).map(([name, { port }]) => [name, configuredPort(env[name]) ?? port])) as PortsOf<T>;
}

function configuredPort(value: string | number | undefined): number | undefined {
    const port = Number(value);

    return value !== "" && Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function isAgentShell(env: LeewayEnv): boolean {
    return AGENT_MARKERS.some(marker => env[marker]);
}

function currentEnv(): LeewayEnv {
    const injected = typeof __LEEWAY_ENV__ === "undefined" ? {} : __LEEWAY_ENV__;
    const processEnv = typeof process === "undefined" ? {} : process.env;

    return { ...injected, ...processEnv };
}
