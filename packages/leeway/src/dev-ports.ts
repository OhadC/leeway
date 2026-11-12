/** Every port the dev setup uses, keyed by port name. Each port name is also the environment variable its port travels in; `port` is the default port. */
export type LeewayCatalogue = Record<string, { port: number }>;

/** Ports every folder uses at once, keyed by port name, in the catalogue's entry shape. Not part of the catalogue: each keeps its `port` in every folder and mode. */
export type LeewayPinnedPorts = Record<string, { port: number }>;

export type LeewayConfig = {
    ports: LeewayCatalogue;
    /** Ports every folder uses at once, like a local Postgres. Never part of a range, so leeway never claims, tests or kills them; a claim refuses one inside the machine's pools. A name can't be in both `ports` and `pinned`. */
    pinned?: LeewayPinnedPorts;
    /** Makes `devPorts` throw in an agent shell (`CLAUDECODE`, `GEMINI_CLI`, `CURSOR_AGENT` or `AI_AGENT` set) when none of the catalogue's port names is set in the environment. Skipped under vitest (`VITEST`) and jest (`JEST_WORKER_ID`). */
    agentGuard?: boolean;
};

export type LeewayEnv = Record<string, string | number | undefined>;

/** One port per port name of `T`'s catalogue and pinned ports. */
export type PortsOf<T extends LeewayConfig> = Record<(keyof T["ports"] | keyof NonNullable<T["pinned"]>) & string, number>;

declare const LEEWAY_ENV: Record<string, number> | undefined;

const AGENT_MARKERS = ["CLAUDECODE", "GEMINI_CLI", "CURSOR_AGENT", "AI_AGENT"];

const TEST_RUNNER_MARKERS = ["VITEST", "JEST_WORKER_ID"];

/**
 * Returns one port per catalogue entry, then per pinned port: the environment variable named after its port name when set, else its `port`.
 * Browser-safe: in the browser it reads the ports injected as `LEEWAY_ENV` by `leeway/vite` or the `{{LEEWAY_ENV}}` placeholder.
 * @param env Defaults to `LEEWAY_ENV` merged with `process.env`.
 * @throws When a set value isn't an integer 1-65535, or when `agentGuard` refuses.
 */
export function devPorts<T extends LeewayConfig>(config: T, env: LeewayEnv = currentEnv()): PortsOf<T> {
    const catalogue = config.ports;

    if (config.agentGuard && isAgentShell(env) && !isTestRun(env) && !Object.keys(catalogue).some(name => env[name])) {
        throw new Error("leeway: agent shell detected without leeway ports; run through `leeway <command>` or `leeway env --export`");
    }

    return Object.fromEntries(
        Object.entries({ ...catalogue, ...config.pinned }).map(([name, { port }]) => [name, environmentPort(name, env[name]) ?? port]),
    ) as PortsOf<T>;
}

function environmentPort(name: string, value: string | number | undefined): number | undefined {
    if (value === undefined || value === "") {
        return undefined;
    }

    const port = Number(value);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`leeway: ${name} is "${value}", not a port 1-65535`);
    }

    return port;
}

function isAgentShell(env: LeewayEnv): boolean {
    return AGENT_MARKERS.some(marker => env[marker]);
}

function isTestRun(env: LeewayEnv): boolean {
    return TEST_RUNNER_MARKERS.some(marker => env[marker]);
}

function currentEnv(): LeewayEnv {
    const injected = typeof LEEWAY_ENV === "undefined" ? {} : LEEWAY_ENV;
    const processEnv = typeof process === "undefined" ? {} : process.env;

    return { ...injected, ...processEnv };
}
