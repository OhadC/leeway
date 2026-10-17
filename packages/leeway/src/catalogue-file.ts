import fs from "node:fs";
import path from "node:path";
import type { LeewayCatalogue } from "./dev-ports.ts";

export type FoundCatalogue = {
    root: string;
    catalogue: LeewayCatalogue;
};

export class CatalogueFile {
    static readonly NAME = "leeway.json";

    static find(from: string): FoundCatalogue {
        const root = CatalogueFile.rootOf(from);

        if (!root) {
            throw new Error(`leeway: no ${CatalogueFile.NAME} in ${path.resolve(from)} or any folder above it`);
        }

        return { root, catalogue: CatalogueFile.read(path.join(root, CatalogueFile.NAME)) };
    }

    static rootOf(from: string): string | undefined {
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
