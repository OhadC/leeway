import fs from "node:fs";
import path from "node:path";
import schema from "../schema.json" with { type: "json" };
import type { LeewayConfig } from "./dev-ports.ts";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SETTINGS = Object.keys(schema.properties).filter(key => key !== "$schema");

const PORTS_SHAPE = '{ "NAME": { "port": <integer 1-65535> } }';

export type FoundConfig = {
    folder: string;
    config: LeewayConfig;
};

export class ConfigFile {
    static readonly NAME = "leeway.json";

    static readonly ALL_PORTS_VARIABLE = "LEEWAY_ENV";

    static readonly FOLDER_VARIABLE = "LEEWAY_FOLDER";

    static find(from: string): FoundConfig {
        const folder = ConfigFile.folderOf(from);

        if (!folder) {
            throw new Error(
                `leeway: no ${ConfigFile.NAME} in ${path.resolve(from)} or any folder above it; create one: { "ports": { "PORT_WEB": { "port": 5173 } } }`,
            );
        }

        return { folder, config: ConfigFile.read(path.join(folder, ConfigFile.NAME)) };
    }

    static folderOf(from: string): string | undefined {
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
            throw new Error(
                `leeway: ${file} must be an object of { "ports": ${PORTS_SHAPE}, "pinned"?: ${PORTS_SHAPE}, "agentGuard"?: <boolean> }`,
            );
        }

        if (!isObject(content.ports) || Object.keys(content.ports).length === 0) {
            throw new Error(`leeway: ${file} needs "ports": ${PORTS_SHAPE}`);
        }

        for (const key of Object.keys(content)) {
            if (!Object.hasOwn(schema.properties, key)) {
                throw new Error(`leeway: ${JSON.stringify(key)} in ${file} is not a setting (${SETTINGS.join(", ")})`);
            }
        }

        if (content.agentGuard !== undefined && typeof content.agentGuard !== "boolean") {
            throw new Error(`leeway: "agentGuard" in ${file} must be true or false`);
        }

        if (content.$schema !== undefined && typeof content.$schema !== "string") {
            throw new Error(`leeway: "$schema" in ${file} must be a string`);
        }

        if (content.pinned !== undefined && !isObject(content.pinned)) {
            throw new Error(`leeway: "pinned" in ${file} must be ${PORTS_SHAPE}`);
        }

        const pinned = content.pinned ?? {};

        ConfigFile.checkEntries(content.ports, file);
        ConfigFile.checkEntries(pinned, file);

        const inBoth = Object.keys(pinned).find(name => Object.hasOwn(content.ports as object, name));

        if (inBoth !== undefined) {
            throw new Error(`leeway: ${inBoth} in ${file} is in both ports and pinned`);
        }

        ConfigFile.checkCaseClash([...Object.keys(content.ports), ...Object.keys(pinned)], file);
        ConfigFile.checkSharedPort(content.ports as LeewayConfig["ports"], file);

        return content as LeewayConfig;
    }

    private static checkCaseClash(names: string[], file: string): void {
        const seen = new Map<string, string>();

        for (const name of names) {
            const clash = seen.get(name.toUpperCase());

            if (clash !== undefined) {
                throw new Error(
                    `leeway: ${clash} and ${name} in ${file} differ only by case, so on Windows they are one environment variable`,
                );
            }

            seen.set(name.toUpperCase(), name);
        }
    }

    private static checkSharedPort(ports: LeewayConfig["ports"], file: string): void {
        const seen = new Map<number, string>();

        for (const [name, { port }] of Object.entries(ports)) {
            const clash = seen.get(port);

            if (clash !== undefined) {
                throw new Error(`leeway: ${clash} and ${name} in ${file} both have port ${port}`);
            }

            seen.set(port, name);
        }
    }

    private static checkEntries(entries: Record<string, unknown>, file: string): void {
        for (const [name, entry] of Object.entries(entries)) {
            if (!ENV_NAME.test(name)) {
                throw new Error(
                    `leeway: ${JSON.stringify(name)} in ${file} is not an environment variable name (letters, digits, _; not starting with a digit)`,
                );
            }

            if (name === ConfigFile.ALL_PORTS_VARIABLE) {
                throw new Error(`leeway: ${name} in ${file} is reserved for the {{${name}}} placeholder`);
            }

            if (name.toUpperCase() === ConfigFile.FOLDER_VARIABLE) {
                throw new Error(`leeway: ${name} in ${file} is reserved for the folder leeway hands down`);
            }

            if (!isPort((entry as { port?: unknown } | null)?.port)) {
                throw new Error(`leeway: ${name} in ${file} needs a "port" that is an integer 1-65535`);
            }
        }
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
