import type { PortListener } from "./listener-scan.ts";
import { RangeRegistry, type RangeEntry } from "./range-registry.ts";

export type KillPlan = {
    scope: string;
    names: Record<string, number>;
    targets: KillTarget[];
    withRuns: boolean;
};

type KillTarget = {
    pid: number;
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

    static planOfPort(entries: RangeEntry[], listeners: PortListener[], port: number): KillPlan {
        const entry = RangeRegistry.entryOfPort(entries, port);

        if (entry) {
            return RangeKill.planOfEntry(entry, listeners);
        }

        if (!RangeRegistry.isInPool(port)) {
            throw new Error(
                `leeway: port ${port} is in no range and outside the pool ${RangeRegistry.POOL_START}-${RangeRegistry.POOL_END}; leeway only kills in ranges and the pool`,
            );
        }

        return {
            scope: `orphan port ${port}`,
            names: {},
            targets: targetsOf(listeners.filter(listener => listener.port === port)),
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
            const failure = failures.get(target.pid);

            return `  pid ${target.pid}  ${ports}  ${failure === undefined ? "killed" : `failed: ${failure}`}`;
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

    listeners.forEach(listener => {
        const target = byPid.get(listener.pid) ?? { pid: listener.pid, ports: [] };

        byPid.set(listener.pid, { ...target, ports: [...target.ports, listener.port] });
    });

    return Array.from(byPid.values());
}
