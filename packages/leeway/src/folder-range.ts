import fs from "node:fs";
import os from "node:os";
import type { FoundConfig } from "./config-file.ts";
import { devPorts, type LeewayConfig, type LeewayEnv } from "./dev-ports.ts";
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
            pinned: FolderRange.pinnedPorts(config),
            platform: process.platform,
            pathExists: fs.existsSync,
            testPort: RangeRegistry.testPort,
            now: Date.now,
        });
    }

    static pinnedPorts({ pinned = {} }: LeewayConfig): Record<string, number> {
        return Object.fromEntries(Object.entries(pinned).map(([name, { port }]) => [name, port]));
    }

    static table({ folder, config }: FoundConfig, ports: Record<string, number>, range?: RangeEntry): string {
        const heading = range ? `ports ${range.start}-${range.end}` : "default ports";
        const nameWidth = Math.max(...Object.keys(ports).map(name => name.length));
        const isPinned = (name: string) => Object.hasOwn(config.pinned ?? {}, name);
        const rows = Object.entries(ports).map(
            ([name, port]) => `  ${name.padEnd(nameWidth)}  ${port}${isPinned(name) ? "  pinned" : ""}\n`,
        );

        return `leeway: ${heading} for ${folder}\n${rows.join("")}`;
    }

    static movedWarning({ entry, previous }: RangeClaim): string | undefined {
        if (!previous) {
            return undefined;
        }

        if (previous.start !== entry.start) {
            return `leeway: range moved from ${previous.start}-${previous.end} to ${entry.start}-${entry.end}; restart anything still using the old ports\n`;
        }

        const lines = Object.entries(entry.ports)
            .filter(([name, port]) => Object.hasOwn(previous.ports, name) && previous.ports[name] !== port)
            .map(
                ([name, port]) =>
                    `leeway: ${name} moved from ${previous.ports[name]} to ${port}; restart anything still using the old port\n`,
            );

        return lines.length > 0 ? lines.join("") : undefined;
    }
}
