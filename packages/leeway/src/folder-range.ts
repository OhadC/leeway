import fs from "node:fs";
import os from "node:os";
import type { FoundConfig } from "./config-file.ts";
import { devPorts, type LeewayEnv } from "./dev-ports.ts";
import { type RangeClaim, type RangeEntry, RangeRegistry } from "./range-registry.ts";

export class FolderRange {
    static readonly FOLDER_VARIABLE = "LEEWAY_FOLDER";

    static inheritedPorts({ folder, config }: FoundConfig, env: LeewayEnv, platform: NodeJS.Platform): Record<string, number> | undefined {
        const outerFolder = env[FolderRange.FOLDER_VARIABLE];
        const isSameFolder = typeof outerFolder === "string" && RangeRegistry.isSameFolder(outerFolder, folder, platform);

        return isSameFolder && Object.keys(config.ports).every(name => env[name]) ? devPorts(config, env) : undefined;
    }

    static claim({ folder, config }: FoundConfig): Promise<RangeClaim> {
        return RangeRegistry.claim({
            registryPath: RangeRegistry.defaultPath(os.homedir()),
            folder,
            names: Object.keys(config.ports),
            platform: process.platform,
            pathExists: fs.existsSync,
            testPort: RangeRegistry.testPort,
            now: Date.now,
        });
    }

    static table(folder: string, ports: Record<string, number>, range?: RangeEntry): string {
        const heading = range ? `ports ${range.start}-${range.end}` : "default ports";
        const nameWidth = Math.max(...Object.keys(ports).map(name => name.length));
        const rows = Object.entries(ports).map(([name, port]) => `  ${name.padEnd(nameWidth)}  ${port}\n`);

        return `leeway: ${heading} for ${folder}\n${rows.join("")}`;
    }

    static movedWarning({ entry, previous }: RangeClaim): string | undefined {
        return previous && previous.start !== entry.start
            ? `leeway: range moved from ${previous.start}-${previous.end} to ${entry.start}-${entry.end}; restart anything still using the old ports\n`
            : undefined;
    }
}
