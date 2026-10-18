import type { Plugin } from "vite";
import { ConfigFile } from "./config-file.ts";
import { devPorts, type LeewayConfig } from "./dev-ports.ts";

export type LeewayViteOptions<T extends LeewayConfig> = {
    config?: T;
    port: NoInfer<keyof T["ports"] & string>;
    preview?: NoInfer<keyof T["ports"] & string>;
    alwaysInject?: boolean;
};

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
                define: { __LEEWAY_ENV__: JSON.stringify(ports) },
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
