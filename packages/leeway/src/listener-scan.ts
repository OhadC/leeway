import { type CommandRunner, OsCommand } from "./os-command.ts";

export type PortListener = {
    port: number;
    pid: number;
};

const WINDOWS_SCAN_SCRIPT =
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess | ConvertTo-Csv -NoTypeInformation";

export class ListenerScan {
    static listeners(platform: NodeJS.Platform = process.platform, run: CommandRunner = OsCommand.run): PortListener[] {
        const scanned = ListenerScan.scan(platform, run);
        const distinct = new Map(scanned.map(listener => [`${listener.port}:${listener.pid}`, listener]));

        return Array.from(distinct.values()).sort((left, right) => left.port - right.port || left.pid - right.pid);
    }

    private static scan(platform: NodeJS.Platform, run: CommandRunner): PortListener[] {
        if (platform === "win32") {
            return ListenerScan.windowsListeners(OsCommand.powershell(run, WINDOWS_SCAN_SCRIPT));
        }

        if (platform === "linux") {
            return ListenerScan.linuxListeners(OsCommand.output(run, "ss", ["-ltnpH"]));
        }

        if (platform === "darwin") {
            return ListenerScan.macListeners(OsCommand.output(run, "lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"], [0, 1]));
        }

        throw new Error(`leeway: listing listeners is not supported on ${platform} yet`);
    }

    private static windowsListeners(csv: string): PortListener[] {
        return csv.split(/\r?\n/).flatMap(line => {
            const match = /^"?(\d+)"?,"?(\d+)"?$/.exec(line.trim());

            return match ? [{ port: Number(match[1]), pid: Number(match[2]) }] : [];
        });
    }

    private static linuxListeners(output: string): PortListener[] {
        return output.split("\n").flatMap(line => {
            const localAddress = line.trim().split(/\s+/)[3] ?? "";
            const port = /:(\d+)$/.exec(localAddress)?.[1];
            const pids = Array.from(line.matchAll(/,pid=(\d+),/g), match => Number(match[1]));

            return port === undefined ? [] : pids.map(pid => ({ port: Number(port), pid }));
        });
    }

    private static macListeners(fields: string): PortListener[] {
        let pid = 0;

        return fields.split("\n").flatMap(line => {
            if (line.startsWith("p")) {
                pid = Number(line.slice(1));
            }

            const port = line.startsWith("n") ? /:(\d+)$/.exec(line)?.[1] : undefined;

            return port === undefined ? [] : [{ port: Number(port), pid }];
        });
    }
}
