import type { Plugin } from "vite";
import { ConfigFile } from "./config-file.ts";
import { devPorts, type LeewayConfig, type PortsOf } from "./dev-ports.ts";

export type LeewayViteOptions<T extends LeewayConfig> = {
    /** The leeway config; passing it types `port` and `preview` against its port names, catalogue and pinned. Defaults to the nearest `leeway.json` from vite's `root`. */
    config?: T;
    /** The port name `vite serve` listens on. */
    port: NoInfer<keyof PortsOf<T>>;
    /** The port name `vite preview` listens on. Defaults to `port`. */
    preview?: NoInfer<keyof PortsOf<T>>;
    /** Apply the ports and `LEEWAY_ENV` on `vite build` too. */
    alwaysInject?: boolean;
};

/**
 * Sets `server.port` and `preview.port` from `devPorts`, with `strictPort: true` so a taken port fails instead of drifting.
 * Defines `LEEWAY_ENV` with every port, pinned ones too, so `devPorts` in browser code sees the server's ports.
 * Leaves `vite build` untouched unless `alwaysInject` is set.
 * @throws When `port` or `preview` isn't a port name of the config.
 */
export function leeway<T extends LeewayConfig = LeewayConfig>(options: LeewayViteOptions<T>): Plugin {
    return {
        name: "leeway",
        config(userConfig, { command }) {
            if (command === "build" && !options.alwaysInject) {
                return {};
            }

            const leewayConfig = options.config ?? ConfigFile.find(userConfig.root ?? process.cwd()).config;
            const ports: Record<string, number> = devPorts(leewayConfig);
            return {
                server: { port: portNamed(ports, options.port), strictPort: true },
                preview: { port: portNamed(ports, options.preview ?? options.port), strictPort: true },
                define: { LEEWAY_ENV: JSON.stringify(ports) },
            };
        },
    };
}

function portNamed(ports: Record<string, number>, name: string): number {
    const port = ports[name];

    if (port === undefined) {
        throw new Error(`leeway: ${name} is not in the catalogue (${Object.keys(ports).join(", ")})`);
    }

    return port;
}
