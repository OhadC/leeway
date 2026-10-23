import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RangeRegistry, type ClaimRangeOptions, type PortBindState } from "./range-registry.ts";

const cleanups: (() => void)[] = [];

afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
});

describe("RangeRegistry.claim", () => {
    it("gives the first folder a range at the start of the pool, one port per name", async () => {
        const home = createHome();
        const registryPath = RangeRegistry.defaultPath(home);

        const { entry, previous } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B", "PORT_C"]);

        expect(entry).toEqual({ folder: "/repo", start: 21000, end: 21002, ports: { PORT_A: 21000, PORT_B: 21001, PORT_C: 21002 } });
        expect(previous).toBeUndefined();
        expect(JSON.parse(fs.readFileSync(path.join(home, ".leeway", "ranges.json"), "utf8"))).toEqual({
            version: 1,
            folders: { "/repo": { start: 21000, end: 21002, ports: { PORT_A: 21000, PORT_B: 21001, PORT_C: 21002 } } },
        });
    });

    it("gives a folder the same range on every claim with the same names", async () => {
        const registryPath = createRegistryPath();
        await claim(registryPath, "/other", ["PORT_X"]);
        const { entry: first } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B"]);

        const again = await claim(registryPath, "/repo", ["PORT_A", "PORT_B"]);

        expect(first).toEqual({ folder: "/repo", start: 21001, end: 21002, ports: { PORT_A: 21001, PORT_B: 21002 } });
        expect(again).toEqual({ entry: first, previous: first });
        expect(Object.keys(readRegistry(registryPath).folders)).toEqual(["/other", "/repo"]);
    });

    it("keeps a deleted folder's range in the registry when the claim keeps its own range", async () => {
        const deleted = { start: 21000, end: 21000, ports: { PORT_X: 21000 } };
        const kept = { start: 21010, end: 21011, ports: { PORT_A: 21010, PORT_B: 21011 } };
        const registryPath = createRegistryPath({ version: 1, folders: { "/deleted": deleted, "/repo": kept } });

        const { entry } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B"], { pathExists: candidate => candidate !== "/deleted" });

        expect(entry).toEqual({ folder: "/repo", ...kept });
        expect(readRegistry(registryPath).folders).toEqual({ "/deleted": deleted, "/repo": kept });
    });

    it("moves a folder whose range overlaps another folder's, as a hand-edited registry can", async () => {
        const registryPath = createRegistryPath({
            version: 1,
            folders: {
                "/other": { start: 21000, end: 21001, ports: { PORT_X: 21000, PORT_Y: 21001 } },
                "/repo": { start: 21001, end: 21002, ports: { PORT_A: 21001, PORT_B: 21002 } },
            },
        });

        const { entry } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B"]);

        expect(entry).toEqual({ folder: "/repo", start: 21002, end: 21003, ports: { PORT_A: 21002, PORT_B: 21003 } });
    });

    it("moves a folder whose range lies outside the pool into the pool", async () => {
        const registryPath = createRegistryPath({
            version: 1,
            folders: { "/repo": { start: 5000, end: 5001, ports: { PORT_A: 5000, PORT_B: 5001 } } },
        });

        const { entry, previous } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B"]);

        expect(entry).toEqual({ folder: "/repo", start: 21000, end: 21001, ports: { PORT_A: 21000, PORT_B: 21001 } });
        expect(previous).toEqual({ folder: "/repo", start: 5000, end: 5001, ports: { PORT_A: 5000, PORT_B: 5001 } });
    });

    it("places folders with different catalogue sizes side by side without overlap", async () => {
        const registryPath = createRegistryPath();

        const small = await claim(registryPath, "/small-repo", ["PORT_A", "PORT_B"]);
        const large = await claim(registryPath, "/large-repo", ["PORT_W", "PORT_X", "PORT_Y", "PORT_Z"]);
        const third = await claim(registryPath, "/third", ["PORT_A", "PORT_B"]);

        expect([small, large, third].map(({ entry: { start, end } }) => ({ start, end }))).toEqual([
            { start: 21000, end: 21001 },
            { start: 21002, end: 21005 },
            { start: 21006, end: 21007 },
        ]);
    });

    it("prunes a deleted folder and hands its range to the next claim that fits", async () => {
        const alive = { start: 21002, end: 21003, ports: { PORT_A: 21002, PORT_B: 21003 } };
        const registryPath = createRegistryPath({
            version: 1,
            folders: { "/deleted": { start: 21000, end: 21001, ports: { PORT_A: 21000, PORT_B: 21001 } }, "/alive": alive },
        });

        const { entry } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B"], { pathExists: candidate => candidate !== "/deleted" });

        expect(entry).toEqual({ folder: "/repo", start: 21000, end: 21001, ports: { PORT_A: 21000, PORT_B: 21001 } });
        expect(readRegistry(registryPath).folders).toEqual({
            "/alive": alive,
            "/repo": { start: 21000, end: 21001, ports: { PORT_A: 21000, PORT_B: 21001 } },
        });
    });

    it("keeps a folder's start when its catalogue grows into free ports", async () => {
        const registryPath = createRegistryPath({
            version: 1,
            folders: {
                "/repo": { start: 21010, end: 21011, ports: { PORT_A: 21010, PORT_B: 21011 } },
                "/other": { start: 21020, end: 21020, ports: { PORT_X: 21020 } },
            },
        });

        const { entry } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B", "PORT_C"]);

        expect(entry).toEqual({ folder: "/repo", start: 21010, end: 21012, ports: { PORT_A: 21010, PORT_B: 21011, PORT_C: 21012 } });
    });

    it("moves a growing folder to the first gap that fits when the next ports belong to another folder", async () => {
        const registryPath = createRegistryPath({
            version: 1,
            folders: {
                "/low": { start: 21000, end: 21001, ports: { PORT_X: 21000, PORT_Y: 21001 } },
                "/repo": { start: 21004, end: 21005, ports: { PORT_A: 21004, PORT_B: 21005 } },
                "/next": { start: 21006, end: 21006, ports: { PORT_X: 21006 } },
            },
        });

        const { entry, previous } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B", "PORT_C", "PORT_D", "PORT_E"]);

        expect(previous).toEqual({ folder: "/repo", start: 21004, end: 21005, ports: { PORT_A: 21004, PORT_B: 21005 } });
        expect(entry).toEqual({
            folder: "/repo",
            start: 21007,
            end: 21011,
            ports: { PORT_A: 21007, PORT_B: 21008, PORT_C: 21009, PORT_D: 21010, PORT_E: 21011 },
        });
    });

    it("keeps a folder's start when its catalogue shrinks", async () => {
        const registryPath = createRegistryPath({
            version: 1,
            folders: { "/repo": { start: 21010, end: 21012, ports: { PORT_A: 21010, PORT_B: 21011, PORT_C: 21012 } } },
        });

        const { entry } = await claim(registryPath, "/repo", ["PORT_A", "PORT_C"]);

        expect(entry).toEqual({ folder: "/repo", start: 21010, end: 21011, ports: { PORT_A: 21010, PORT_C: 21011 } });
    });

    it("skips past a port something else holds or the OS reserved to the next start whose ports are all free", async () => {
        const registryPath = createRegistryPath();

        const { entry } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B"], {
            testPort: portStates({ 21001: "in-use", 21003: "unavailable" }),
        });

        expect(entry).toEqual({ folder: "/repo", start: 21004, end: 21005, ports: { PORT_A: 21004, PORT_B: 21005 } });
    });

    it("keeps a folder's range while its own servers listen on it", async () => {
        const registryPath = createRegistryPath({
            version: 1,
            folders: { "/repo": { start: 21010, end: 21011, ports: { PORT_A: 21010, PORT_B: 21011 } } },
        });

        const { entry } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B", "PORT_C"], {
            testPort: portStates({ 21010: "in-use", 21011: "in-use" }),
        });

        expect(entry).toEqual({ folder: "/repo", start: 21010, end: 21012, ports: { PORT_A: 21010, PORT_B: 21011, PORT_C: 21012 } });
    });

    it("moves a folder when one of its ports with no listener has become unavailable", async () => {
        const registryPath = createRegistryPath({
            version: 1,
            folders: {
                "/other": { start: 21000, end: 21001, ports: { PORT_X: 21000, PORT_Y: 21001 } },
                "/repo": { start: 21010, end: 21011, ports: { PORT_A: 21010, PORT_B: 21011 } },
            },
        });

        const { entry, previous } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B"], {
            testPort: portStates({ 21010: "in-use", 21011: "unavailable" }),
        });

        expect(previous).toEqual({ folder: "/repo", start: 21010, end: 21011, ports: { PORT_A: 21010, PORT_B: 21011 } });
        expect(entry).toEqual({ folder: "/repo", start: 21002, end: 21003, ports: { PORT_A: 21002, PORT_B: 21003 } });
        expect(readRegistry(registryPath).folders["/repo"]).toEqual({ start: 21002, end: 21003, ports: { PORT_A: 21002, PORT_B: 21003 } });
    });

    it("treats another folder's entry with extra keys as holding its ports, and keeps its keys", async () => {
        const newer = { start: 21000, end: 21001, ports: { PORT_X: 21000, PORT_Y: 21001 }, pool: "web", pinned: true };
        const registryPath = createRegistryPath({ version: 1, folders: { "/newer": newer } });

        const { entry } = await claim(registryPath, "/repo", ["PORT_A"]);

        expect(entry.start).toBe(21002);
        expect(readRegistry(registryPath).folders["/newer"]).toEqual(newer);
    });

    it("keeps the extra keys of the folder's own entry when the claim keeps its range", async () => {
        const registryPath = createRegistryPath({
            version: 1,
            folders: { "/repo": { start: 21010, end: 21010, ports: { PORT_A: 21010 }, pool: "web" } },
        });

        await claim(registryPath, "/repo", ["PORT_A", "PORT_B"]);

        expect(readRegistry(registryPath).folders["/repo"]).toEqual({
            start: 21010,
            end: 21011,
            ports: { PORT_A: 21010, PORT_B: 21011 },
            pool: "web",
        });
    });

    it("keeps the extra keys of the folder's own entry when the claim moves its range", async () => {
        const registryPath = createRegistryPath({
            version: 1,
            folders: {
                "/repo": { start: 21010, end: 21010, ports: { PORT_A: 21010 }, pool: "web" },
                "/next": { start: 21011, end: 21011, ports: { PORT_X: 21011 } },
            },
        });

        await claim(registryPath, "/repo", ["PORT_A", "PORT_B"]);

        expect(readRegistry(registryPath).folders["/repo"]).toEqual({
            start: 21000,
            end: 21001,
            ports: { PORT_A: 21000, PORT_B: 21001 },
            pool: "web",
        });
    });

    it("treats a range reaching outside the pool as holding its ports", async () => {
        const straddling = { start: 20990, end: 21004, ports: { PORT_X: 20990, PORT_Y: 21004 } };
        const registryPath = createRegistryPath({ version: 1, folders: { "/straddling": straddling } });

        const { entry } = await claim(registryPath, "/repo", ["PORT_A"]);

        expect(entry.start).toBe(21005);
        expect(readRegistry(registryPath).folders["/straddling"]).toEqual(straddling);
    });

    it("writes back entries without a readable range unchanged, without treating them as holding ports", async () => {
        const unknown = {
            "/no-range": { ports: { PORT_A: 21000 }, pool: "web" },
            "/reversed": { start: 21001, end: 21000, ports: { PORT_A: 21000 } },
            "/past-the-last-port": { start: 21000, end: 65536, ports: { PORT_A: 21000 } },
            "/fractional": { start: 21000.5, end: 21001, ports: { PORT_A: 21001 } },
            "/text": { start: "21000", end: "21001", ports: { PORT_A: 21000 } },
            "/not-an-object": "21000",
        };
        const registryPath = createRegistryPath({ version: 1, folders: unknown });

        const { entry } = await claim(registryPath, "/repo", ["PORT_A", "PORT_B"]);

        expect(entry.start).toBe(21000);
        expect(readRegistry(registryPath).folders).toEqual({
            ...unknown,
            "/repo": { start: 21000, end: 21001, ports: { PORT_A: 21000, PORT_B: 21001 } },
        });
    });

    it("treats differently spelled paths of one Windows folder as one folder", async () => {
        const registryPath = createRegistryPath();

        const { entry: first } = await claim(registryPath, "C:\\Worktrees\\Repo", ["PORT_A"], { platform: "win32" });
        const { entry: second } = await claim(registryPath, "c:/worktrees/repo/", ["PORT_A"], { platform: "win32" });

        expect(second).toEqual({ folder: "c:\\worktrees\\repo", start: 21000, end: 21000, ports: { PORT_A: 21000 } });
        expect(second).toEqual(first);
        expect(Object.keys(readRegistry(registryPath).folders)).toEqual(["c:\\worktrees\\repo"]);
    });

    it("recognises a folder's entry stored under a differently spelled key, and rewrites it under one key", async () => {
        const stored = { start: 21010, end: 21010, ports: { PORT_A: 21010 } };
        const registryPath = createRegistryPath({ version: 1, folders: { "C:/Worktrees/Repo/": stored } });

        const { entry, previous } = await claim(registryPath, "c:\\worktrees\\repo", ["PORT_A"], { platform: "win32" });

        expect(entry).toEqual({ folder: "c:\\worktrees\\repo", ...stored });
        expect(previous).toEqual(entry);
        expect(readRegistry(registryPath).folders).toEqual({ "c:\\worktrees\\repo": stored });
    });

    it("keeps Linux folder paths that differ only in case apart", async () => {
        const registryPath = createRegistryPath();

        const upper = await claim(registryPath, "/home/dev/Repo", ["PORT_A"]);
        const lower = await claim(registryPath, "/home/dev/repo/", ["PORT_A"]);

        expect([upper.entry.start, lower.entry.start]).toEqual([21000, 21001]);
        expect(Object.keys(readRegistry(registryPath).folders)).toEqual(["/home/dev/Repo", "/home/dev/repo"]);
    });

    it.each([7, "2.0"])("claims from a registry with version %j and keeps that version", async version => {
        const registryPath = createRegistryPath({ version, folders: {} });

        const { entry } = await claim(registryPath, "/repo", ["PORT_A"]);

        expect(entry).toEqual({ folder: "/repo", start: 21000, end: 21000, ports: { PORT_A: 21000 } });
        expect(readRegistry(registryPath).version).toBe(version);
    });

    it("claims from a registry without a version and writes none", async () => {
        const registryPath = createRegistryPath({ folders: {} });

        const { entry } = await claim(registryPath, "/repo", ["PORT_A"]);

        expect(entry).toEqual({ folder: "/repo", start: 21000, end: 21000, ports: { PORT_A: 21000 } });
        expect(readRegistry(registryPath)).not.toHaveProperty("version");
    });

    it("keeps top-level registry data it does not understand", async () => {
        const registryPath = createRegistryPath({ version: 1, pools: { web: [30000, 30999] }, folders: {} });

        await claim(registryPath, "/repo", ["PORT_A"]);

        expect(readRegistry(registryPath)).toEqual({
            version: 1,
            pools: { web: [30000, 30999] },
            folders: { "/repo": { start: 21000, end: 21000, ports: { PORT_A: 21000 } } },
        });
    });

    it.each([
        ["corrupt JSON", "{ not json"],
        ["a JSON array", "[]"],
        ["a registry without folders", JSON.stringify({ version: 1 })],
        ["a registry whose folders is not an object", JSON.stringify({ version: 1, folders: [] })],
    ])("refuses to claim from %s, leaving the file alone", async (_, contents) => {
        const registryPath = createRegistryPath();
        fs.mkdirSync(path.dirname(registryPath), { recursive: true });
        fs.writeFileSync(registryPath, contents);

        await expect(claim(registryPath, "/repo", ["PORT_A"])).rejects.toThrow(registryPath);
        expect(fs.readFileSync(registryPath, "utf8")).toBe(contents);
    });

    it("fails with a remove-unused-ranges message when no gap in the 21000-29999 pool fits", async () => {
        const hogPorts = Object.fromEntries(Array.from({ length: 8996 }, (_, index) => [`PORT_${index}`, 21000 + index]));
        const registryPath = createRegistryPath({
            version: 1,
            folders: { "/hog": { start: 21000, end: 29995, ports: hogPorts } },
        });

        await expect(claim(registryPath, "/too-big", ["PORT_A", "PORT_B", "PORT_C", "PORT_D", "PORT_E"])).rejects.toThrow(
            /remove unused folders' ranges/,
        );
        expect(await claim(registryPath, "/fits", ["PORT_A", "PORT_B", "PORT_C", "PORT_D"])).toMatchObject({
            entry: { start: 29996, end: 29999 },
        });
    });
});

describe("RangeRegistry.claim lock", () => {
    it("waits while another claim holds the lock, then claims once it finishes", async () => {
        const registryPath = createRegistryPath();
        const holder = heldClaim(registryPath, "/holder");
        await holder.locked;

        const waiter = settledFlag(claim(registryPath, "/repo", ["PORT_A"]));
        await pause(200);
        const whileLocked = waiter.settled();
        holder.finish();

        expect(whileLocked).toBe(false);
        expect(await holder.claimed).toMatchObject({ entry: { start: 21000 } });
        expect(await waiter.claimed).toMatchObject({ entry: { start: 21001 } });
    });

    it("breaks a lock older than about ten seconds, left by a crashed claim", async () => {
        const registryPath = createRegistryPath();
        await heldClaim(registryPath, "/crashed").locked;

        const { entry } = await claim(registryPath, "/repo", ["PORT_A"], { now: () => Date.now() + 11_000 });

        expect(entry).toEqual({ folder: "/repo", start: 21000, end: 21000, ports: { PORT_A: 21000 } });
    });

    it("does not let a claim whose stale lock was broken release the lock of the claim that broke it", async () => {
        const registryPath = createRegistryPath();
        const slow = heldClaim(registryPath, "/slow");
        await slow.locked;
        const breaker = heldClaim(registryPath, "/breaker", { now: () => Date.now() + 11_000 });
        await breaker.locked;

        slow.finish();
        await slow.claimed;
        const waiter = settledFlag(claim(registryPath, "/repo", ["PORT_A"]));
        await pause(200);
        const whileBreakerHolds = waiter.settled();
        breaker.finish();

        expect(whileBreakerHolds).toBe(false);
        await waiter.claimed;
    });

    it("releases the lock after a successful claim, so the next claim does not wait", async () => {
        const registryPath = createRegistryPath();

        await claim(registryPath, "/first", ["PORT_A"]);

        expect(await claim(registryPath, "/repo", ["PORT_A"], { now: () => Date.now() - 60_000 })).toMatchObject({
            entry: { start: 21001 },
        });
    });

    it("releases the lock after a failed claim", async () => {
        const registryPath = createRegistryPath([]);

        await expect(claim(registryPath, "/repo", ["PORT_A"])).rejects.toThrow(
            `leeway: ${registryPath} is not a valid range registry; fix or delete it`,
        );
        fs.writeFileSync(registryPath, JSON.stringify({ version: 1, folders: {} }));
        expect(await claim(registryPath, "/repo", ["PORT_A"], { now: () => Date.now() - 60_000 })).toMatchObject({
            entry: { start: 21000 },
        });
    });
});

describe("RangeRegistry.testPort", () => {
    it("reports a port with a loopback listener as in use, and the same port free once the listener closes", async () => {
        const server = net.createServer();
        await new Promise<void>(resolve => server.listen({ port: 0, host: "127.0.0.1" }, resolve));
        const { port } = server.address() as net.AddressInfo;

        const whileListening = await RangeRegistry.testPort(port);
        await new Promise(resolve => server.close(resolve));

        expect([whileListening, await RangeRegistry.testPort(port)]).toEqual(["in-use", "free"]);
    });
});

describe("RangeRegistry.livingEntries", () => {
    it("returns the readable ranges of existing folders wherever they sit, without rewriting the file", () => {
        const alive = { start: 21002, end: 21003, ports: { PORT_A: 21002, PORT_B: 21003 } };
        const registryPath = createRegistryPath({
            version: 2,
            folders: {
                "/deleted": { start: 21000, end: 21001, ports: { PORT_A: 21000, PORT_B: 21001 } },
                "/alive": alive,
                "/newer": { start: 21004, end: 21004, ports: { PORT_A: 21004 }, pool: "web" },
                "/outside-pool": { start: 5000, end: 5000, ports: { PORT_A: 5000 } },
                "/unreadable-ports": { start: 21006, end: 21007, ports: { PORT_A: 21009 } },
                "/no-range": { ports: { PORT_A: 21008 } },
            },
        });
        const before = fs.readFileSync(registryPath, "utf8");

        expect(RangeRegistry.livingEntries(registryPath, candidate => candidate !== "/deleted")).toEqual([
            { folder: "/alive", ...alive },
            { folder: "/newer", start: 21004, end: 21004, ports: { PORT_A: 21004 } },
            { folder: "/outside-pool", start: 5000, end: 5000, ports: { PORT_A: 5000 } },
            { folder: "/unreadable-ports", start: 21006, end: 21007, ports: {} },
        ]);
        expect(fs.readFileSync(registryPath, "utf8")).toBe(before);
    });

    it("returns no entries when there is no registry yet", () => {
        expect(RangeRegistry.livingEntries(createRegistryPath(), () => true)).toEqual([]);
    });
});

describe("RangeRegistry lookups", () => {
    const repo = { folder: "c:\\worktrees\\repo", start: 21000, end: 21001, ports: { PORT_A: 21000, PORT_B: 21001 } };
    const other = { folder: "c:\\worktrees\\other", start: 21002, end: 21002, ports: { PORT_X: 21002 } };

    it("finds a folder's entry by any spelling of its path on Windows", () => {
        expect(RangeRegistry.entryOfFolder([other, repo], "C:/Worktrees/Repo/", "win32")).toBe(repo);
        expect(RangeRegistry.entryOfFolder([other, repo], "C:/Worktrees/Missing", "win32")).toBeUndefined();
    });

    it("finds the entry whose range holds a port", () => {
        expect(RangeRegistry.entryOfPort([repo, other], 21002)).toBe(other);
        expect(RangeRegistry.entryOfPort([repo, other], 21003)).toBeUndefined();
    });

    it("tells whether a port is in the 21000-29999 pool", () => {
        expect([20999, 21000, 29999, 30000].map(port => RangeRegistry.isInPool(port))).toEqual([false, true, true, false]);
    });
});

function createHome(): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "leeway-ranges-"));
    cleanups.push(() => fs.rmSync(home, { recursive: true, force: true }));

    return home;
}

function createRegistryPath(contents?: unknown): string {
    const registryPath = RangeRegistry.defaultPath(createHome());

    if (contents !== undefined) {
        fs.mkdirSync(path.dirname(registryPath), { recursive: true });
        fs.writeFileSync(registryPath, JSON.stringify(contents));
    }

    return registryPath;
}

function readRegistry(registryPath: string): { version: unknown; folders: Record<string, unknown> } {
    return JSON.parse(fs.readFileSync(registryPath, "utf8"));
}

function claim(registryPath: string, folder: string, names: string[], overrides: Partial<ClaimRangeOptions> = {}) {
    return RangeRegistry.claim({
        registryPath,
        folder,
        names,
        platform: "linux",
        pathExists: () => true,
        testPort: portStates({}),
        now: Date.now,
        ...overrides,
    });
}

function heldClaim(registryPath: string, folder: string, overrides: Partial<ClaimRangeOptions> = {}) {
    let markLocked!: () => void;
    let finish!: () => void;
    const locked = new Promise<void>(resolve => (markLocked = resolve));
    const finished = new Promise<void>(resolve => (finish = resolve));
    const testPort = async () => {
        markLocked();
        await finished;

        return "free" as const;
    };

    return { locked, finish, claimed: claim(registryPath, folder, ["PORT_A"], { testPort, ...overrides }) };
}

function settledFlag<T>(promise: Promise<T>) {
    let settled = false;
    const claimed = promise.finally(() => {
        settled = true;
    });

    return { claimed, settled: () => settled };
}

function pause(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function portStates(states: Record<number, PortBindState>): ClaimRangeOptions["testPort"] {
    return async port => states[port] ?? "free";
}
