import type { PortListener } from "./listener-scan.ts";
import { RangeRegistry, type RangeEntry } from "./range-registry.ts";

export type ListedPort = {
    name: string;
    port: number;
    pids: number[];
};

export type ListedRange = Omit<RangeEntry, "ports"> & {
    ports: ListedPort[];
};

export type Listing = {
    ranges: ListedRange[];
    orphans: PortListener[];
};

export class RangeListing {
    static collect(entries: RangeEntry[], listeners: PortListener[]): Listing {
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

        const orphans = listeners.filter(
            listener => RangeRegistry.isInPool(listener.port) && !RangeRegistry.entryOfPort(entries, listener.port),
        );

        return { ranges, orphans };
    }

    static render({ ranges, orphans }: Listing): string {
        if (ranges.length === 0 && orphans.length === 0) {
            return `leeway: no ranges are registered and nothing is listening in ${RangeRegistry.POOL_START}-${RangeRegistry.POOL_END}\n`;
        }

        const blocks = ranges.map(RangeListing.renderRange);

        if (orphans.length > 0) {
            blocks.push(
                ["orphans (in the pool, outside every range)", ...orphans.map(orphan => `  ${orphan.port}  ${pidCell([orphan.pid])}`)].join(
                    "\n",
                ),
            );
        }

        return `${blocks.join("\n\n")}\n`;
    }

    private static renderRange(range: ListedRange): string {
        const nameWidth = Math.max(...range.ports.map(listed => listed.name.length));
        const rows = range.ports.map(listed => `  ${listed.name.padEnd(nameWidth)}  ${listed.port}  ${pidCell(listed.pids)}`);

        return [`${range.folder}  ${range.start}-${range.end}`, ...rows].join("\n");
    }
}

function pidCell(pids: number[]): string {
    return pids.length === 0 ? "-" : `pid ${pids.join(", ")}`;
}
