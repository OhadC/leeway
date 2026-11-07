import type { PortListener } from "./listener-scan.ts";
import { type Pool, Pools } from "./pools.ts";
import type { ProcessRow } from "./process-tree.ts";
import { RangeRegistry, type RangeEntry } from "./range-registry.ts";

export type ListedRange = Omit<RangeEntry, "ports"> & {
    ports: ListedPort[];
};

export type Listing = {
    ranges: ListedRange[];
    orphans: PortListener[];
    commands: Record<string, string>;
};

type ListedPort = {
    name: string;
    port: number;
    pids: (number | null)[];
};

export class RangeListing {
    private static readonly SHORT_COMMAND_LENGTH = 60;

    static collect(entries: RangeEntry[], listeners: PortListener[], pools: Pool[], processRows: ProcessRow[]): Listing {
        const ranges = [...entries]
            .sort((left, right) => left.start - right.start)
            .map(entry => ({
                folder: entry.folder,
                start: entry.start,
                end: entry.end,
                ports: Object.entries(entry.ports)
                    .sort(([, left], [, right]) => left - right)
                    .map(([name, port]) => ({
                        name,
                        port,
                        pids: listeners.filter(listener => listener.port === port).map(listener => listener.pid),
                    })),
            }));
        const orphans = RangeListing.orphans(entries, listeners, pools);
        const listedPids = new Set([
            ...ranges.flatMap(range => range.ports.flatMap(listed => listed.pids)),
            ...orphans.map(orphan => orphan.pid),
        ]);
        const commands = Object.fromEntries(
            processRows.filter(row => listedPids.has(row.pid) && row.commandLine !== "").map(row => [String(row.pid), row.commandLine]),
        );

        return { ranges, orphans, commands };
    }

    static orphans(entries: RangeEntry[], listeners: PortListener[], pools: Pool[]): PortListener[] {
        return listeners.filter(listener => Pools.holds(pools, listener.port) && !RangeRegistry.entryOfPort(entries, listener.port));
    }

    static render(listing: Listing, pools: Pool[], thisFolder: string | undefined, platform: NodeJS.Platform): string {
        const { ranges, orphans, commands } = listing;

        if (ranges.length === 0 && orphans.length === 0) {
            return `leeway: no ranges are registered and nothing is listening in ${Pools.text(pools)}\n`;
        }

        const blocks = ranges.map(range => {
            const isThisFolder = thisFolder !== undefined && RangeRegistry.isSameFolder(range.folder, thisFolder, platform);

            return RangeListing.renderRange(range, commands, isThisFolder);
        });

        if (orphans.length > 0) {
            blocks.push(
                [
                    "orphans (in a pool, outside every range)",
                    ...orphans.flatMap(orphan => listenerLines(`  ${orphan.port}  `, [orphan.pid], commands)),
                ].join("\n"),
            );
        }

        return `${blocks.join("\n\n")}\n`;
    }

    static shortCommand(commandLine: string): string {
        const tokens = commandLine.match(/(?:"[^"]*"|[^\s"])+/g) ?? [];
        const short = tokens.map(token => token.replaceAll('"', "").split(/[\\/]/).at(-1)).join(" ");

        return short.length > RangeListing.SHORT_COMMAND_LENGTH ? `${short.slice(0, RangeListing.SHORT_COMMAND_LENGTH - 1)}…` : short;
    }

    private static renderRange(range: ListedRange, commands: Record<string, string>, isThisFolder: boolean): string {
        const nameWidth = Math.max(...range.ports.map(listed => listed.name.length));
        const header = `${range.folder}  ${range.start}-${range.end}${isThisFolder ? "  (this folder)" : ""}`;
        const rows = range.ports.flatMap(listed =>
            listenerLines(`  ${listed.name.padEnd(nameWidth)}  ${listed.port}  `, listed.pids, commands),
        );

        return [header, ...rows].join("\n");
    }
}

function listenerLines(prefix: string, pids: (number | null)[], commands: Record<string, string>): string[] {
    if (pids.length === 0) {
        return [`${prefix}-`];
    }

    return pids.map((pid, index) => `${index === 0 ? prefix : " ".repeat(prefix.length)}${listenerCell(pid, commands)}`);
}

function listenerCell(pid: number | null, commands: Record<string, string>): string {
    if (pid === null) {
        return "pid ?";
    }

    const commandLine = commands[pid];

    return commandLine === undefined ? `pid ${pid}` : `pid ${pid}  ${RangeListing.shortCommand(commandLine)}`;
}
