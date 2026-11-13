import type { PortListener } from "../os/listener-scan.ts";
import { ProcessTree, type ProcessRow } from "../os/process-tree.ts";
import { RangeListing } from "./range-listing.ts";

const KILL_OR_MOVE = "if it's this folder's, leeway kill; if not, leeway move";

export class PortHolders {
    static hint(inUse: Record<string, number>, listeners: PortListener[], rows: ProcessRow[]): string {
        return Object.entries(inUse)
            .map(([name, port]) => `leeway: ${port} (${name}) is in use by ${PortHolders.holder(port, listeners, rows)}\n`)
            .join("");
    }

    private static holder(port: number, listeners: PortListener[], rows: ProcessRow[]): string {
        const pid = listeners.find(listener => listener.port === port && listener.pid !== null)?.pid;

        if (!pid) {
            return `a process leeway can't see; ${KILL_OR_MOVE}`;
        }

        const row = rows.find(candidate => candidate.pid === pid);
        const named = row?.commandLine ? `pid ${pid} (${RangeListing.shortCommand(row.commandLine)})` : `pid ${pid}`;

        return ProcessTree.leewayRunOf(pid, rows) === undefined
            ? `${named}, which leeway did not start; ${KILL_OR_MOVE}`
            : `${named}, started by leeway; if it shouldn't still be running, stop it with leeway kill`;
    }
}
