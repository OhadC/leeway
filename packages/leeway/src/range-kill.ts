import type { PortListener } from "./listener-scan.ts";
import { type Pool, Pools } from "./pools.ts";
import { RangeListing } from "./range-listing.ts";
import { RangeRegistry, type RangeEntry } from "./range-registry.ts";

export type KillPlan = {
    scope: string;
    names: Record<string, number>;
    targets: KillTarget[];
    withRuns: boolean;
};

type KillTarget = {
    pid: number | null;
    ports: number[];
};

export class RangeKill {
    static planOfFolder(entries: RangeEntry[], listeners: PortListener[], folder: string, platform: NodeJS.Platform): KillPlan {
        const entry = RangeRegistry.entryOfFolder(entries, folder, platform);

        if (!entry) {
            throw new Error(`leeway: no range is registered for ${folder}`);
        }

        return RangeKill.planOfEntry(entry, listeners);
    }

    static planOfPort(entries: RangeEntry[], listeners: PortListener[], port: number, readPools: () => Pool[]): KillPlan {
        const entry = RangeRegistry.entryOfPort(entries, port);

        if (entry) {
            return RangeKill.planOfEntry(entry, listeners);
        }

        const pools = readPools();

        if (!Pools.holds(pools, port)) {
            throw new Error(
                `leeway: port ${port} is in no range and outside every pool (${Pools.text(pools)}); leeway only kills in ranges and pools`,
            );
        }

        return {
            scope: `orphan port ${port}`,
            names: {},
            targets: targetsOf(listeners.filter(listener => listener.port === port)),
            withRuns: false,
        };
    }

    static planOfOrphans(entries: RangeEntry[], listeners: PortListener[], pools: Pool[]): KillPlan {
        return {
            scope: `${Pools.text(pools)} outside every range`,
            names: {},
            targets: targetsOf(RangeListing.orphans(entries, listeners, pools)),
            withRuns: false,
        };
    }

    static render({ scope, names, targets }: KillPlan, failures: Map<number, string>): string {
        if (targets.length === 0) {
            return `leeway: nothing is listening in ${scope}\n`;
        }

        const nameOfPort = new Map(Object.entries(names).map(([name, port]) => [port, name]));
        const lines = targets.map(target => {
            const ports = target.ports.map(port => [nameOfPort.get(port), port].filter(Boolean).join(" ")).join(", ");
            const failure = target.pid === null ? "pid hidden, run with sudo to kill it" : failures.get(target.pid);

            return `  pid ${target.pid ?? "?"}  ${ports}  ${failure === undefined ? "killed" : `failed: ${failure}`}`;
        });

        return [`leeway: ${scope}`, ...lines, ""].join("\n");
    }

    private static planOfEntry(entry: RangeEntry, listeners: PortListener[]): KillPlan {
        return {
            scope: `${entry.folder}  ${entry.start}-${entry.end}`,
            names: entry.ports,
            targets: targetsOf(listeners.filter(listener => listener.port >= entry.start && listener.port <= entry.end)),
            withRuns: true,
        };
    }
}

function targetsOf(listeners: PortListener[]): KillTarget[] {
    const byPid = new Map<number, KillTarget>();
    const hiddenTargets: KillTarget[] = [];

    listeners.forEach(({ pid, port }) => {
        if (pid === null) {
            hiddenTargets.push({ pid, ports: [port] });
        } else {
            byPid.set(pid, { pid, ports: [...(byPid.get(pid)?.ports ?? []), port] });
        }
    });

    return [...byPid.values(), ...hiddenTargets];
}
