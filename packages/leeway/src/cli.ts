#!/usr/bin/env node
import { CatalogueFile, type FoundCatalogue } from "./catalogue-file.ts";
import { devPorts } from "./dev-ports.ts";
import { ExecCommand, type ExecMode, type ExecRequest } from "./exec-command.ts";
import { FolderRange } from "./folder-range.ts";
import { ListenerScan } from "./listener-scan.ts";
import { ProcessTree } from "./process-tree.ts";
import { RangeKill } from "./range-kill.ts";
import { RangeListing } from "./range-listing.ts";
import { RangeRegistry } from "./range-registry.ts";
import { RunWithPorts } from "./run-with-ports.ts";

const USAGE = [
    "usage: leeway [--defaults] [--] <command>   run <command> with this folder's range, or the default ports, as env vars; {{NAME}} in <command> becomes its port",
    "       leeway env --export                  claim this folder's range and print it as export lines",
    "       leeway list                          show every range, the pids listening in it, and orphan listeners in the pool",
    "       leeway kill [<port>]                 kill what listens in this folder's range, or in the range holding <port>, or on an orphan <port>",
].join("\n");

const SUBCOMMANDS = new Set(["env", "list", "kill"]);

async function runLeeway(): Promise<void> {
    const args = process.argv.slice(2);
    const [subcommand, ...rest] = args;
    const request = SUBCOMMANDS.has(subcommand ?? "") ? undefined : ExecCommand.requestOf(args);

    if (request) {
        await execWithPorts(CatalogueFile.find(process.cwd()), request);
    } else if (subcommand === "env" && rest.length === 1 && rest[0] === "--export") {
        await printExportLines(CatalogueFile.find(process.cwd()));
    } else if (subcommand === "list" && rest.length === 0) {
        process.stdout.write(RangeListing.render(RangeListing.collect(RangeRegistry.livingEntries(), ListenerScan.listeners())));
    } else if (subcommand === "kill" && rest.length <= 1 && rest.every(arg => /^\d+$/.test(arg))) {
        killRange(rest[0]);
    } else {
        failWith(USAGE);
    }
}

async function execWithPorts(found: FoundCatalogue, { mode, command }: ExecRequest): Promise<void> {
    const ports = await portsOfMode(found, mode);

    RunWithPorts.runAndExit(ExecCommand.commandLine(command, ports), ports);
}

async function portsOfMode(found: FoundCatalogue, mode: ExecMode): Promise<Record<string, number>> {
    if (mode === "defaults") {
        const ports = devPorts(found.catalogue, {});

        process.stderr.write(FolderRange.table(found.folder, ports));

        return ports;
    }

    const claim = await FolderRange.claim(found);

    process.stderr.write(FolderRange.table(found.folder, claim.entry.ports, claim.entry) + (FolderRange.movedWarning(claim) ?? ""));

    return claim.entry.ports;
}

async function printExportLines(found: FoundCatalogue): Promise<void> {
    const ports = await portsOfMode(found, "claim");

    process.stdout.write(
        Object.entries(ports)
            .map(([name, port]) => `export ${name}=${port}\n`)
            .join(""),
    );
}

function killRange(port: string | undefined): void {
    const entries = RangeRegistry.livingEntries();
    const listeners = ListenerScan.listeners().filter(listener => listener.pid !== process.pid);
    const plan =
        port === undefined
            ? RangeKill.planOfFolder(entries, listeners, CatalogueFile.find(process.cwd()).folder, process.platform)
            : RangeKill.planOfPort(entries, listeners, Number(port));
    const failures = new Map<number, string>();

    plan.targets.forEach(({ pid }) => {
        try {
            ProcessTree.killTree(pid);
        } catch (error) {
            failures.set(pid, error instanceof Error ? error.message : String(error));
        }
    });

    process.stdout.write(RangeKill.render(plan, failures));

    if (failures.size > 0) {
        process.exit(1);
    }
}

function failWith(message: string): never {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

try {
    await runLeeway();
} catch (error) {
    failWith(error instanceof Error ? error.message : String(error));
}
