import fs from "node:fs";
import path from "node:path";
import type { LeewayConfig } from "./dev-ports.ts";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SETTINGS = ["ports", "agentGuard"];

const PORTS_SHAPE = '{ "NAME": { "port": <integer 1-65535> } }';

export type FoundConfig = {
    folder: string;
    config: LeewayConfig;
};

export class ConfigFile {
    static readonly NAME = "leeway.json";

    static find(from: string): FoundConfig {
        const folder = ConfigFile.folderOf(from);

        if (!folder) {
            throw new Error(`leeway: no ${ConfigFile.NAME} in ${path.resolve(from)} or any folder above it`);
        }

        return { folder, config: ConfigFile.read(path.join(folder, ConfigFile.NAME)) };
    }

    private static folderOf(from: string): string | undefined {
        let current = path.resolve(from);

        while (!fs.existsSync(path.join(current, ConfigFile.NAME))) {
            if (current === path.dirname(current)) {
                return undefined;
            }

            current = path.dirname(current);
        }

        return current;
    }

    private static read(file: string): LeewayConfig {
        const content = ConfigFile.readJson(file);

        if (!isObject(content)) {
            throw new Error(`leeway: ${file} must be an object of { "ports": ${PORTS_SHAPE}, "agentGuard"?: <boolean> }`);
        }

        if (!isObject(content.ports)) {
            throw new Error(`leeway: ${file} needs "ports": ${PORTS_SHAPE}`);
        }

        for (const setting of Object.keys(content)) {
            if (!SETTINGS.includes(setting)) {
                throw new Error(`leeway: ${JSON.stringify(setting)} in ${file} is not a setting (${SETTINGS.join(", ")})`);
            }
        }

        if (content.agentGuard !== undefined && typeof content.agentGuard !== "boolean") {
            throw new Error(`leeway: "agentGuard" in ${file} must be true or false`);
        }

        for (const [name, entry] of Object.entries(content.ports)) {
            if (!ENV_NAME.test(name)) {
                throw new Error(
                    `leeway: ${JSON.stringify(name)} in ${file} is not an environment variable name (letters, digits, _; not starting with a digit)`,
                );
            }

            if (!isPort((entry as { port?: unknown } | null)?.port)) {
                throw new Error(`leeway: ${name} in ${file} needs a "port" that is an integer 1-65535`);
            }
        }

        return content as LeewayConfig;
    }

    private static readJson(file: string): unknown {
        const text = fs.readFileSync(file, "utf8");

        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`leeway: ${file} is not valid JSON`);
        }
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPort(value: unknown): boolean {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}
