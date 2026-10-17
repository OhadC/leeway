import type { PortListener } from "./listener-scan.ts";
import { RangeRegistry, type RangeEntry } from "./range-registry.ts";

export type KillTarget = {
    pid: number;
    ports: number[];
};

export type KillPlan = {
    entry: RangeEntry;
    targets: KillTarget[];
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

        if (!entry) {
            throw new Error(`leeway: port ${port} is not in any living range; see \`leeway list\``);
        }

        return RangeKill.planOfEntry(entry, listeners);
    }

    static render({ entry, targets }: KillPlan, failures: Map<number, string>): string {
        const range = `${entry.folder}  ${entry.start}-${entry.end}`;

        if (targets.length === 0) {
            return `leeway: nothing is listening in ${range}\n`;
        }

        const lines = targets.map(target => {
            const ports = target.ports.map(port => `${RangeRegistry.nameOfPort(entry, port) ?? "?"} ${port}`).join(", ");
            const failure = failures.get(target.pid);

            return `  pid ${target.pid}  ${ports}  ${failure === undefined ? "killed" : `failed: ${failure}`}`;
        });

        return [`leeway: ${range}`, ...lines, ""].join("\n");
    }

    private static planOfEntry(entry: RangeEntry, listeners: PortListener[]): KillPlan {
        const byPid = new Map<number, KillTarget>();

        listeners
            .filter(listener => listener.port >= entry.start && listener.port <= entry.end)
            .forEach(listener => {
                const target = byPid.get(listener.pid) ?? { pid: listener.pid, ports: [] };

                byPid.set(listener.pid, { ...target, ports: [...target.ports, listener.port] });
            });

        return { entry, targets: Array.from(byPid.values()) };
    }
}
