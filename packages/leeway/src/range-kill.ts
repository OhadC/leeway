import type { PortListener } from "./listener-scan.ts";
import { type Pool, Pools } from "./pools.ts";
import { RangeListing } from "./range-listing.ts";
import { RangeRegistry, type RangeEntry } from "./range-registry.ts";

export type KillPlan = RangePlan | OrphanPlan;

type RangePlan = {
    kind: "range";
    scope: string;
    names: Record<string, number>;
    targets: KillTarget[];
};

type OrphanPlan = {
    kind: "orphan";
    scope: string;
    targets: KillTarget[];
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
            kind: "orphan",
            scope: `orphan port ${port}`,
            targets: targetsOf(listeners.filter(listener => listener.port === port)),
        };
    }

    static planOfOrphans(entries: RangeEntry[], listeners: PortListener[], pools: Pool[]): KillPlan {
        return {
            kind: "orphan",
            scope: `${Pools.text(pools)} outside every range`,
            targets: targetsOf(RangeListing.orphans(entries, listeners, pools)),
        };
    }

    static render(plan: KillPlan, failures: Map<number, string>): string {
        const { scope, targets } = plan;

        if (targets.length === 0) {
            return `leeway: nothing is listening in ${scope}\n`;
        }

        const names = plan.kind === "range" ? plan.names : {};
        const nameOfPort = new Map(Object.entries(names).map(([name, port]) => [port, name]));
        const lines = targets.map(target => {
            const ports = target.ports.map(port => [nameOfPort.get(port), port].filter(Boolean).join(" ")).join(", ");
            const failure = target.pid === null ? "pid hidden, run with sudo to kill it" : failures.get(target.pid);

            return `  pid ${target.pid ?? "?"}  ${ports}  ${failure === undefined ? "killed" : `failed: ${failure}`}`;
        });

        return [`leeway: ${scope}`, ...lines, ""].join("\n");
    }

    static visiblePids({ targets }: KillPlan): number[] {
        return targets.flatMap(target => (target.pid === null ? [] : [target.pid]));
    }

    static failed({ targets }: KillPlan, failures: Map<number, string>): boolean {
        return failures.size > 0 || targets.some(target => target.pid === null);
    }

    private static planOfEntry(entry: RangeEntry, listeners: PortListener[]): RangePlan {
        return {
            kind: "range",
            scope: `${entry.folder}  ${entry.start}-${entry.end}`,
            names: entry.ports,
            targets: targetsOf(listeners.filter(listener => listener.port >= entry.start && listener.port <= entry.end)),
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
