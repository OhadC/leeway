import fs from "node:fs";
import os from "node:os";
import type { FoundCatalogue } from "./catalogue-file.ts";
import { type RangeEntry, RangeRegistry } from "./range-registry.ts";

export type FolderClaim = {
    entry: RangeEntry;
    previous: RangeEntry | undefined;
};

export class FolderRange {
    static async claim({ root, catalogue }: FoundCatalogue): Promise<FolderClaim> {
        const registryPath = RangeRegistry.defaultPath(os.homedir());
        const previous = RangeRegistry.entryOfFolder(RangeRegistry.livingEntries(registryPath), root, process.platform);
        const entry = await RangeRegistry.claim({
            registryPath,
            folder: root,
            names: Object.keys(catalogue),
            platform: process.platform,
            pathExists: fs.existsSync,
            testPort: RangeRegistry.testPort,
            now: Date.now,
        });

        return { entry, previous };
    }

    static table(folder: string, ports: Record<string, number>, range?: RangeEntry): string {
        const heading = range ? `ports ${range.start}-${range.end}` : "default ports";
        const nameWidth = Math.max(...Object.keys(ports).map(name => name.length));
        const rows = Object.entries(ports).map(([name, port]) => `  ${name.padEnd(nameWidth)}  ${port}\n`);

        return `leeway: ${heading} for ${folder}\n${rows.join("")}`;
    }

    static movedWarning({ entry, previous }: FolderClaim): string | undefined {
        return previous && previous.start !== entry.start
            ? `leeway: range moved from ${previous.start}-${previous.end} to ${entry.start}-${entry.end}; restart anything still using the old ports\n`
            : undefined;
    }
}
