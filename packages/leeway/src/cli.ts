#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ConfigFile, type FoundConfig } from "./config-file.ts";
import { devPorts } from "./dev-ports.ts";
import { ExecCommand, type ExecMode, type ExecRequest } from "./exec-command.ts";
import { FolderRange } from "./folder-range.ts";
import { ListenerScan, type PortListener } from "./listener-scan.ts";
import { Pools } from "./pools.ts";
import { ProcessTree } from "./process-tree.ts";
import { type KillPlan, RangeKill } from "./range-kill.ts";
import { RangeListing } from "./range-listing.ts";
import { type RangeEntry, RangeRegistry } from "./range-registry.ts";
import { RunWithPorts } from "./run-with-ports.ts";

const USAGE = [
    "usage: leeway [--default | --inherit] [--] <command>   run <command> with this folder's range as env vars; {{NAME}} in <command> becomes its port, {{LEEWAY_ENV}} every port as JSON",
    "                                                       --default: the default ports; --inherit: the ports in the environment, else the default ports",
    "       leeway env [--export]                           claim this folder's range and print it as dotenv lines, or export lines",
    "       leeway list [--json]                            show every range, the pids listening in it, and orphan listeners in the pools",
    "       leeway kill [<port> | --orphans]                kill what listens in this folder's range, or in the range holding <port>, or on an orphan <port>",
    "                                                       --orphans: every orphan in the pools",
    "       leeway release [<folder>]                       release this folder's range, or <folder>'s, so its ports go back to the pools",
    "       leeway pools [set <start-end>... | reset]       show the machine's pools, set them in order of preference, or go back to the default pool",
    "       leeway --help | -h | --version",
].join("\n");

const SUBCOMMANDS = new Set(["env", "list", "kill", "release", "pools"]);

async function runLeeway(): Promise<void> {
    const args = process.argv.slice(2);
    const [subcommand, ...rest] = args;
    const request = SUBCOMMANDS.has(subcommand ?? "") ? undefined : ExecCommand.requestOf(args);

    if (subcommand === "--help" || subcommand === "-h") {
        process.stdout.write(`${USAGE}\n`);
    } else if (subcommand === "--version") {
        const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

        process.stdout.write(`${version}\n`);
    } else if (request) {
        await execWithPorts(ConfigFile.find(process.cwd()), request);
    } else if (subcommand === "env" && (rest.length === 0 || (rest.length === 1 && rest[0] === "--export"))) {
        await printEnvLines(ConfigFile.find(process.cwd()), rest[0] === "--export");
    } else if (subcommand === "list" && (rest.length === 0 || (rest.length === 1 && rest[0] === "--json"))) {
        const pools = RangeRegistry.pools();
        const listing = RangeListing.collect(RangeRegistry.livingEntries(), ListenerScan.listeners(), pools);

        process.stdout.write(rest.length === 0 ? RangeListing.render(listing, pools) : `${JSON.stringify(listing, undefined, 4)}\n`);
    } else if (subcommand === "kill" && rest.length <= 1 && rest.every(arg => /^\d+$/.test(arg) || arg === "--orphans")) {
        killRange(rest[0]);
    } else if (subcommand === "release" && rest.length <= 1 && rest.every(arg => !arg.startsWith("-"))) {
        await releaseRange(rest[0]);
    } else if (subcommand === "pools" && rest[0] === "set") {
        await RangeRegistry.setPools(rest.slice(1));
        printPools();
    } else if (subcommand === "pools" && rest.length === 1 && rest[0] === "reset") {
        await RangeRegistry.resetPools();
        printPools();
    } else if (subcommand === "pools" && rest.length === 0) {
        printPools();
    } else {
        failWith(USAGE);
    }
}

async function execWithPorts(found: FoundConfig, { mode, command }: ExecRequest): Promise<void> {
    const names = Object.keys(found.config.ports);
    const unknown = ExecCommand.unknownPlaceholders(command, names);

    if (unknown.length > 0) {
        failWith(`leeway: unknown ${unknown.map(name => `{{${name}}}`).join(", ")} in the command; the catalogue has ${names.join(", ")}`);
    }

    const ports = await portsOfMode(found, mode);

    RunWithPorts.runAndExit(ExecCommand.commandLine(command, ports), { ...ports, [FolderRange.FOLDER_VARIABLE]: found.folder });
}

async function portsOfMode(found: FoundConfig, mode: ExecMode): Promise<Record<string, number>> {
    if (mode === "inherit") {
        return devPorts(found.config);
    }

    if (mode === "default") {
        const ports = devPorts(found.config, {});

        process.stderr.write(FolderRange.table(found.folder, ports));

        return ports;
    }

    const inherited = FolderRange.inheritedPorts(found, process.env, process.platform);

    if (inherited) {
        return inherited;
    }

    const claim = await FolderRange.claim(found);

    process.stderr.write(FolderRange.table(found.folder, claim.entry.ports, claim.entry) + (FolderRange.movedWarning(claim) ?? ""));

    return claim.entry.ports;
}

async function printEnvLines(found: FoundConfig, asExports: boolean): Promise<void> {
    const ports = await portsOfMode(found, "claim");
    const linePrefix = asExports ? "export " : "";

    process.stdout.write(
        Object.entries(ports)
            .map(([name, port]) => `${linePrefix}${name}=${port}\n`)
            .join(""),
    );
}

function killRange(arg: string | undefined): void {
    const entries = RangeRegistry.livingEntries();
    const listeners = ListenerScan.listeners().filter(listener => listener.pid !== process.pid);
    const plan = killPlan(entries, listeners, arg);
    const failures = ProcessTree.killTrees(
        plan.targets.map(target => target.pid),
        plan.withRuns,
    );

    process.stdout.write(RangeKill.render(plan, failures));

    if (failures.size > 0) {
        process.exit(1);
    }
}

function killPlan(entries: RangeEntry[], listeners: PortListener[], arg: string | undefined): KillPlan {
    if (arg === undefined) {
        return RangeKill.planOfFolder(entries, listeners, ConfigFile.find(process.cwd()).folder, process.platform);
    }

    if (arg === "--orphans") {
        return RangeKill.planOfOrphans(entries, listeners, RangeRegistry.pools());
    }

    return RangeKill.planOfPort(entries, listeners, Number(arg), () => RangeRegistry.pools());
}

async function releaseRange(folder: string | undefined): Promise<void> {
    const pools = RangeRegistry.pools();
    const released = await RangeRegistry.release(folder === undefined ? ConfigFile.find(process.cwd()).folder : path.resolve(folder));
    const { start, end } = released;
    const orphans = ListenerScan.listeners().filter(
        listener => listener.port >= start && listener.port <= end && Pools.holds(pools, listener.port),
    );

    process.stdout.write(
        `leeway: released ${start}-${end} for ${released.folder}\n` +
            orphans
                .map(({ pid, port }) => `  pid ${pid}  ${port}  still listening, now an orphan; stop it with leeway kill ${port}\n`)
                .join(""),
    );
}

function printPools(): void {
    process.stdout.write(Pools.render(RangeRegistry.pools()));
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
