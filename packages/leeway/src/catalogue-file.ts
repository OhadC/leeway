import fs from "node:fs";
import path from "node:path";
import type { LeewayCatalogue } from "./dev-ports.ts";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type FoundCatalogue = {
    folder: string;
    catalogue: LeewayCatalogue;
};

export class CatalogueFile {
    static readonly NAME = "leeway.json";

    static find(from: string): FoundCatalogue {
        const folder = CatalogueFile.folderOf(from);

        if (!folder) {
            throw new Error(`leeway: no ${CatalogueFile.NAME} in ${path.resolve(from)} or any folder above it`);
        }

        return { folder, catalogue: CatalogueFile.read(path.join(folder, CatalogueFile.NAME)) };
    }

    private static folderOf(from: string): string | undefined {
        let current = path.resolve(from);

        while (!fs.existsSync(path.join(current, CatalogueFile.NAME))) {
            if (current === path.dirname(current)) {
                return undefined;
            }

            current = path.dirname(current);
        }

        return current;
    }

    private static read(file: string): LeewayCatalogue {
        const content = CatalogueFile.readJson(file);

        if (typeof content !== "object" || content === null || Array.isArray(content)) {
            throw new Error(`leeway: ${file} must be an object of { "NAME": { "port": <integer 1-65535> } }`);
        }

        for (const [name, entry] of Object.entries(content)) {
            if (!ENV_NAME.test(name)) {
                throw new Error(
                    `leeway: ${JSON.stringify(name)} in ${file} is not an environment variable name (letters, digits, _; not starting with a digit)`,
                );
            }

            if (!isPort((entry as { port?: unknown } | null)?.port)) {
                throw new Error(`leeway: ${name} in ${file} needs a "port" that is an integer 1-65535`);
            }
        }

        return content as LeewayCatalogue;
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

function isPort(value: unknown): boolean {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}
