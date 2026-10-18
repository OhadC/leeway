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
    version: number;
    folders: Record<string, unknown>;
};

export class RangeRegistry {
    static readonly POOL_START = 21000;
    static readonly POOL_END = 29999;
    private static readonly VERSION = 1;

    static defaultPath(home: string): string {
        return path.join(home, ".leeway", "ranges.json");
    }

    static async claim(options: ClaimRangeOptions): Promise<RangeClaim> {
        const lockPath = `${options.registryPath}.lock`;

        const owner = await RangeRegistry.acquireLock(lockPath, options.now);

        try {
            return await RangeRegistry.claimLocked(options);
        } finally {
            RangeRegistry.releaseLock(lockPath, owner);
        }
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
        return Object.entries(RangeRegistry.read(registryPath).folders)
            .filter((pair): pair is [string, StoredRange] => RangeRegistry.isStoredRange(pair[1]) && pathExists(pair[0]))
            .map(([folder, range]) => ({ folder, ...range }));
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

    static isInPool(port: number): boolean {
        return port >= RangeRegistry.POOL_START && port <= RangeRegistry.POOL_END;
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

        if (registry.version > RangeRegistry.VERSION) {
            throw new Error(
                `leeway: ${registryPath} has format version ${registry.version}, this leeway knows ${RangeRegistry.VERSION}; update leeway`,
            );
        }

        const entries = Object.entries(registry.folders);
        const isOwn = ([key]: [string, unknown]) => RangeRegistry.folderKey(key, platform) === folder;
        const current = entries
            .filter(isOwn)
            .map(([, value]) => value)
            .find(RangeRegistry.isStoredRange);
        const others = entries.filter(pair => !isOwn(pair));
        const kept = current && (await RangeRegistry.keep(current, names, RangeRegistry.storedRanges(others), testPort));
        const living = kept ? others : others.filter(([key]) => pathExists(key));
        const range = kept ?? (await RangeRegistry.allocate(current, RangeRegistry.storedRanges(living), names, testPort));

        if (!range) {
            throw new Error(
                `leeway: no room for ${names.length} ports in ${RangeRegistry.POOL_START}-${RangeRegistry.POOL_END}; remove unused folders' ranges from ${registryPath} and try again`,
            );
        }

        RangeRegistry.write(registryPath, {
            version: RangeRegistry.VERSION,
            folders: { ...Object.fromEntries(living), [folder]: range },
        });

        return { entry: { folder, ...range }, previous: current && { folder, ...current } };
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
        testPort: ClaimRangeOptions["testPort"],
    ): Promise<StoredRange | undefined> {
        const ownPorts = new Set(Object.values(current.ports));
        const blocked = await RangeRegistry.firstBlockedPort(current.start, names.length, stored, ownPorts, testPort);

        return blocked === undefined ? RangeRegistry.rangeAt(current.start, names) : undefined;
    }

    private static async allocate(
        current: StoredRange | undefined,
        occupied: StoredRange[],
        names: readonly string[],
        testPort: ClaimRangeOptions["testPort"],
    ): Promise<StoredRange | undefined> {
        const ownPorts = new Set(Object.values(current?.ports ?? {}));
        const firstBlockedPort = (start: number) => RangeRegistry.firstBlockedPort(start, names.length, occupied, ownPorts, testPort);

        if (current && (await firstBlockedPort(current.start)) === undefined) {
            return RangeRegistry.rangeAt(current.start, names);
        }

        for (let start = RangeRegistry.POOL_START; start + names.length - 1 <= RangeRegistry.POOL_END;) {
            const blocked = await firstBlockedPort(start);

            if (blocked === undefined) {
                return RangeRegistry.rangeAt(start, names);
            }

            start = blocked + 1;
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

        if (!isObject(registry) || !Number.isInteger(registry.version) || !isObject(registry.folders)) {
            throw new Error(`leeway: ${registryPath} is not a valid range registry; fix or delete it`);
        }

        return registry as RegistryFile;
    }

    private static storedRanges(pairs: [string, unknown][]): StoredRange[] {
        return pairs.map(([, value]) => value).filter(RangeRegistry.isStoredRange);
    }

    private static isStoredRange(value: unknown): value is StoredRange {
        if (!isObject(value)) {
            return false;
        }

        const { start, end, ports } = value as StoredRange;

        if (Object.keys(value).length !== 3 || !Number.isInteger(start) || !Number.isInteger(end) || !isObject(ports)) {
            return false;
        }

        if (!RangeRegistry.isInPool(start) || !RangeRegistry.isInPool(end)) {
            return false;
        }

        const portNumbers = Object.values(ports);

        return portNumbers.length === end - start + 1 && portNumbers.every(port => Number.isInteger(port) && port >= start && port <= end);
    }

    private static async firstBlockedPort(
        start: number,
        size: number,
        occupied: StoredRange[],
        ownPorts: Set<number>,
        testPort: ClaimRangeOptions["testPort"],
    ): Promise<number | undefined> {
        const end = start + size - 1;

        if (end > RangeRegistry.POOL_END) {
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

function bindErrorCode(port: number, host: string): Promise<string | undefined> {
    return new Promise(resolve => {
        const server = net.createServer();

        server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "UNKNOWN"));
        server.listen({ port, host }, () => server.close(() => resolve(undefined)));
    });
}
