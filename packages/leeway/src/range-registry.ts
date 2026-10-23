import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export type RangeEntry = {
    folder: string;
    start: number;
    end: number;
    ports: Record<string, number>;
};

export type RangeClaim = {
    entry: RangeEntry;
    previous: RangeEntry | undefined;
};

export type Pool = {
    start: number;
    end: number;
};

export type PortBindState = "free" | "in-use" | "unavailable";

export type ClaimRangeOptions = {
    registryPath: string;
    folder: string;
    names: readonly string[];
    platform: NodeJS.Platform;
    pathExists: (candidate: string) => boolean;
    testPort: (port: number) => Promise<PortBindState>;
    now: () => number;
};

const LOCK_RETRY_MS = 50;

const LOCK_STALE_MS = 10_000;

const LOCK_BUSY_CODES = new Set(["EEXIST", "ENOTEMPTY", "EPERM", "EACCES", "EBUSY"]);

const BIND_HOSTS = ["127.0.0.1", "::1", "0.0.0.0", "::"];

const MISSING_ADDRESS_FAMILY_CODES = new Set(["EAFNOSUPPORT", "EADDRNOTAVAIL"]);

type StoredRange = Omit<RangeEntry, "folder">;

type RegistryFile = {
    [key: string]: unknown;
    folders: Record<string, unknown>;
};

export class RangeRegistry {
    static readonly DEFAULT_POOL: Pool = { start: 21000, end: 29999 };
    private static readonly VERSION = 1;

    static defaultPath(home: string): string {
        return path.join(home, ".leeway", "ranges.json");
    }

    static claim(options: ClaimRangeOptions): Promise<RangeClaim> {
        return RangeRegistry.whileLocked(options.registryPath, options.now, () => RangeRegistry.claimLocked(options));
    }

    static pools(registryPath = RangeRegistry.defaultPath(os.homedir())): Pool[] | undefined {
        return RangeRegistry.poolsOf(RangeRegistry.read(registryPath), registryPath);
    }

    static async setPools(registryPath: string, texts: readonly string[]): Promise<void> {
        const pools = texts.map(poolOfText);
        const problem = poolsProblem(pools);

        if (problem) {
            throw new Error(`leeway: ${problem}`);
        }

        await RangeRegistry.whileLocked(registryPath, Date.now, () =>
            RangeRegistry.write(registryPath, { ...RangeRegistry.read(registryPath), pools }),
        );
    }

    static async resetPools(registryPath: string): Promise<void> {
        await RangeRegistry.whileLocked(registryPath, Date.now, () => {
            const registry = RangeRegistry.read(registryPath);

            delete registry.pools;
            RangeRegistry.write(registryPath, registry);
        });
    }

    static async testPort(port: number): Promise<PortBindState> {
        for (const host of BIND_HOSTS) {
            const code = await bindErrorCode(port, host);

            if (code && !MISSING_ADDRESS_FAMILY_CODES.has(code)) {
                return code === "EADDRINUSE" ? "in-use" : "unavailable";
            }
        }

        return "free";
    }

    static livingEntries(
        registryPath = RangeRegistry.defaultPath(os.homedir()),
        pathExists: (candidate: string) => boolean = fs.existsSync,
    ): RangeEntry[] {
        return Object.entries(RangeRegistry.read(registryPath).folders).flatMap(([folder, value]) => {
            const range = RangeRegistry.readableRange(value);

            return range && pathExists(folder) ? [{ folder, ...range }] : [];
        });
    }

    static entryOfFolder(entries: RangeEntry[], folder: string, platform: NodeJS.Platform): RangeEntry | undefined {
        return entries.find(entry => RangeRegistry.isSameFolder(entry.folder, folder, platform));
    }

    static isSameFolder(left: string, right: string, platform: NodeJS.Platform): boolean {
        return RangeRegistry.folderKey(left, platform) === RangeRegistry.folderKey(right, platform);
    }

    static entryOfPort(entries: RangeEntry[], port: number): RangeEntry | undefined {
        return entries.find(entry => port >= entry.start && port <= entry.end);
    }

    static isInPools(port: number, pools: Pool[]): boolean {
        return pools.some(pool => port >= pool.start && port <= pool.end);
    }

    static textOfPools(pools: Pool[]): string {
        return pools.map(textOfPool).join(", ");
    }

    private static folderKey(folder: string, platform: NodeJS.Platform): string {
        return platform === "win32" ? path.win32.resolve(folder).toLowerCase() : path.posix.resolve(folder);
    }

    private static async claimLocked({
        registryPath,
        folder: folderPath,
        names,
        platform,
        pathExists,
        testPort,
    }: ClaimRangeOptions): Promise<RangeClaim> {
        const folder = RangeRegistry.folderKey(folderPath, platform);
        const registry = RangeRegistry.read(registryPath);
        const pools = RangeRegistry.poolsOf(registry, registryPath) ?? [RangeRegistry.DEFAULT_POOL];
        const entries = Object.entries(registry.folders);
        const isOwn = ([key]: [string, unknown]) => RangeRegistry.folderKey(key, platform) === folder;
        const own = entries.filter(isOwn);
        const [current] = RangeRegistry.readableRanges(own);
        const ownKeys = Object.fromEntries(own.flatMap(([, value]) => (isObject(value) ? Object.entries(value) : [])));
        const others = entries.filter(pair => !isOwn(pair));
        const kept = current && (await RangeRegistry.keep(current, names, RangeRegistry.readableRanges(others), pools, testPort));
        const living = kept ? others : others.filter(([key]) => pathExists(key));
        const range = kept ?? (await RangeRegistry.place(current, RangeRegistry.readableRanges(living), names, pools, testPort));

        if (!range) {
            throw new Error(
                `leeway: no room for ${names.length} ports in ${RangeRegistry.textOfPools(pools)}; remove unused folders' ranges from ${registryPath} and try again`,
            );
        }

        RangeRegistry.write(registryPath, {
            ...registry,
            folders: { ...Object.fromEntries(living), [folder]: { ...ownKeys, ...range } },
        });

        return { entry: { folder, ...range }, previous: current && { folder, ...current } };
    }

    private static async whileLocked<T>(registryPath: string, now: ClaimRangeOptions["now"], action: () => T | Promise<T>): Promise<T> {
        const lockPath = `${registryPath}.lock`;
        const owner = await RangeRegistry.acquireLock(lockPath, now);

        try {
            return await action();
        } finally {
            RangeRegistry.releaseLock(lockPath, owner);
        }
    }

    private static async acquireLock(lockPath: string, now: ClaimRangeOptions["now"]): Promise<string> {
        const owner = randomUUID();
        const proposal = `${lockPath}.${owner}`;

        fs.mkdirSync(proposal, { recursive: true });

        try {
            for (;;) {
                fs.writeFileSync(path.join(proposal, owner), "");

                try {
                    fs.renameSync(proposal, lockPath);
                    return owner;
                } catch (error) {
                    if (!LOCK_BUSY_CODES.has((error as NodeJS.ErrnoException).code ?? "")) {
                        throw error;
                    }
                }

                RangeRegistry.breakStaleLock(lockPath, now());
                await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS));
            }
        } finally {
            fs.rmSync(proposal, { recursive: true, force: true });
        }
    }

    private static breakStaleLock(lockPath: string, now: number): void {
        try {
            fs.readdirSync(lockPath)
                .map(owner => path.join(lockPath, owner))
                .filter(ownerPath => now - fs.statSync(ownerPath).mtimeMs > LOCK_STALE_MS)
                .forEach(ownerPath => fs.rmSync(ownerPath, { force: true }));
            fs.rmdirSync(lockPath);
        } catch {
            return;
        }
    }

    private static releaseLock(lockPath: string, owner: string): void {
        fs.rmSync(path.join(lockPath, owner), { force: true });

        try {
            fs.rmdirSync(lockPath);
        } catch {
            return;
        }
    }

    private static async keep(
        current: StoredRange,
        names: readonly string[],
        stored: StoredRange[],
        pools: Pool[],
        testPort: ClaimRangeOptions["testPort"],
    ): Promise<StoredRange | undefined> {
        const ownPorts = new Set(Object.values(current.ports));
        const blocked = await RangeRegistry.firstBlockedPort(current.start, names.length, stored, pools, ownPorts, testPort);

        return blocked === undefined ? RangeRegistry.rangeAt(current.start, names) : undefined;
    }

    private static async place(
        current: StoredRange | undefined,
        occupied: StoredRange[],
        names: readonly string[],
        pools: Pool[],
        testPort: ClaimRangeOptions["testPort"],
    ): Promise<StoredRange | undefined> {
        const ownPorts = new Set(Object.values(current?.ports ?? {}));
        const firstBlockedPort = (start: number) =>
            RangeRegistry.firstBlockedPort(start, names.length, occupied, pools, ownPorts, testPort);

        if (current && (await firstBlockedPort(current.start)) === undefined) {
            return RangeRegistry.rangeAt(current.start, names);
        }

        for (const pool of pools) {
            for (let start = pool.start; start + names.length - 1 <= pool.end;) {
                const blocked = await firstBlockedPort(start);

                if (blocked === undefined) {
                    return RangeRegistry.rangeAt(start, names);
                }

                start = blocked + 1;
            }
        }

        return undefined;
    }

    private static read(registryPath: string): RegistryFile {
        let text: string;

        try {
            text = fs.readFileSync(registryPath, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return { version: RangeRegistry.VERSION, folders: {} };
            }

            throw error;
        }

        const registry = parseJson(text);

        if (!isObject(registry) || !isObject(registry.folders)) {
            throw new Error(`leeway: ${registryPath} is not a valid range registry; fix or delete it`);
        }

        return { ...registry, folders: registry.folders };
    }

    private static poolsOf(registry: RegistryFile, registryPath: string): Pool[] | undefined {
        if (!("pools" in registry)) {
            return undefined;
        }

        const problem = poolsProblem(registry.pools);

        if (problem) {
            throw new Error(
                `leeway: the pools in ${registryPath} are unreadable (${problem}); fix it with leeway pools set or leeway pools reset`,
            );
        }

        return registry.pools as Pool[];
    }

    private static readableRanges(pairs: [string, unknown][]): StoredRange[] {
        return pairs.flatMap(([, value]) => RangeRegistry.readableRange(value) ?? []);
    }

    private static readableRange(value: unknown): StoredRange | undefined {
        if (!isObject(value)) {
            return undefined;
        }

        const { start, end, ports } = value;

        if (!isPortNumber(start) || !isPortNumber(end) || start > end) {
            return undefined;
        }

        const hasReadablePorts = isObject(ports) && Object.values(ports).every(port => isPortNumber(port) && port >= start && port <= end);

        return { start, end, ports: hasReadablePorts ? (ports as Record<string, number>) : {} };
    }

    private static async firstBlockedPort(
        start: number,
        size: number,
        occupied: StoredRange[],
        pools: Pool[],
        ownPorts: Set<number>,
        testPort: ClaimRangeOptions["testPort"],
    ): Promise<number | undefined> {
        const end = start + size - 1;

        if (!pools.some(pool => pool.start <= start && end <= pool.end)) {
            return end;
        }

        const overlapping = occupied.filter(range => range.start <= end && range.end >= start);

        if (overlapping.length > 0) {
            return Math.max(...overlapping.map(range => range.end));
        }

        for (let port = start; port <= end; port++) {
            const state = await testPort(port);

            if (state !== "free" && !(state === "in-use" && ownPorts.has(port))) {
                return port;
            }
        }

        return undefined;
    }

    private static rangeAt(start: number, names: readonly string[]): StoredRange {
        return {
            start,
            end: start + names.length - 1,
            ports: Object.fromEntries(names.map((name, index) => [name, start + index])),
        };
    }

    private static write(registryPath: string, registry: RegistryFile): void {
        const temporaryPath = `${registryPath}.${process.pid}.tmp`;

        fs.mkdirSync(path.dirname(registryPath), { recursive: true });
        fs.writeFileSync(temporaryPath, `${JSON.stringify(registry, undefined, 4)}\n`);
        fs.renameSync(temporaryPath, registryPath);
    }
}

function poolsProblem(pools: unknown): string | undefined {
    if (!Array.isArray(pools) || pools.length === 0) {
        return "at least one pool is needed, written start-end";
    }

    const unreadable = pools.find(pool => !isObject(pool) || !isPortNumber(pool.start) || !isPortNumber(pool.end));

    if (unreadable !== undefined) {
        return `${labelOfPool(unreadable)} is not a pool of ports 1-65535`;
    }

    const readable = pools as Pool[];
    const reversed = readable.find(pool => pool.start > pool.end);

    if (reversed) {
        return `${textOfPool(reversed)} starts after it ends`;
    }

    const byStart = [...readable].sort((left, right) => left.start - right.start);
    const overlapping = byStart.findIndex((pool, index) => index > 0 && pool.start <= byStart[index - 1]!.end);

    return overlapping === -1 ? undefined : `${textOfPool(byStart[overlapping - 1]!)} and ${textOfPool(byStart[overlapping]!)} overlap`;
}

function poolOfText(text: string): Pool {
    const match = /^(\d+)-(\d+)$/.exec(text);

    if (!match) {
        throw new Error(`leeway: ${text} is not a pool; write it start-end, like 21000-29999`);
    }

    return { start: Number(match[1]), end: Number(match[2]) };
}

function labelOfPool(value: unknown): string {
    return isObject(value) && typeof value.start === "number" && typeof value.end === "number"
        ? textOfPool({ start: value.start, end: value.end })
        : JSON.stringify(value);
}

function textOfPool({ start, end }: Pool): string {
    return `${start}-${end}`;
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPortNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function bindErrorCode(port: number, host: string): Promise<string | undefined> {
    return new Promise(resolve => {
        const server = net.createServer();

        server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "UNKNOWN"));
        server.listen({ port, host }, () => server.close(() => resolve(undefined)));
    });
}
