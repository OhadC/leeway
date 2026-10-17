import type { Plugin, UserConfig } from "vite";
import { CatalogueFile } from "./catalogue-file.ts";
import { devPorts, type LeewayCatalogue } from "./dev-ports.ts";

export type LeewayViteOptions<T extends LeewayCatalogue> = {
    catalogue?: T;
    port: NoInfer<keyof T & string>;
    preview?: NoInfer<keyof T & string>;
    alwaysInject?: boolean;
};

export function leeway<T extends LeewayCatalogue = LeewayCatalogue>(options: LeewayViteOptions<T>): Plugin {
    return {
        name: "leeway",
        config(userConfig, { command }) {
            if (command === "build" && !options.alwaysInject) {
                return {};
            }

            const catalogue = options.catalogue ?? CatalogueFile.find(userConfig.root ?? process.cwd()).catalogue;
            const ports: Record<string, number> = devPorts(catalogue);
            const config: UserConfig = { server: { port: portNamed(ports, options.port), strictPort: true } };

            if (options.preview) {
                config.preview = { port: portNamed(ports, options.preview), strictPort: true };
            }

            if (command === "serve" || options.alwaysInject) {
                config.define = { __LEEWAY_ENV__: JSON.stringify(ports) };
            }

            return config;
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
