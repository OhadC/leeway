import { describe, expect, it } from "vitest";
import { type Pool, Pools } from "./pools.ts";
import type { RangeEntry } from "./range-registry.ts";
import { RangeListing } from "./range-listing.ts";

const APP: RangeEntry = { folder: "C:\\dev\\app", start: 21000, end: 21001, ports: { web: 21000, server: 21001 } };

const TOOL: RangeEntry = { folder: "C:\\dev\\tool", start: 21002, end: 21002, ports: { docs: 21002 } };

describe("RangeListing.collect", () => {
    it("lists every range by start with the pid listening on each named port", () => {
        const listing = RangeListing.collect([TOOL, APP], [{ port: 21001, pid: 40 }], Pools.DEFAULT, []);

        expect(listing.ranges).toEqual([
            {
                folder: "C:\\dev\\app",
                start: 21000,
                end: 21001,
                ports: [
                    { name: "web", port: 21000, pids: [] },
                    { name: "server", port: 21001, pids: [40] },
                ],
            },
            { folder: "C:\\dev\\tool", start: 21002, end: 21002, ports: [{ name: "docs", port: 21002, pids: [] }] },
        ]);
    });

    it("lists every pid listening on a port", () => {
        const listing = RangeListing.collect(
            [TOOL],
            [
                { port: 21002, pid: 60 },
                { port: 21002, pid: 61 },
            ],
            Pools.DEFAULT,
            [],
        );

        expect(listing.ranges[0]?.ports).toEqual([{ name: "docs", port: 21002, pids: [60, 61] }]);
    });

    it("lists a listener whose pid is hidden as a null pid, printed pid ?, in a range and as an orphan", () => {
        const listing = RangeListing.collect(
            [TOOL],
            [
                { port: 21002, pid: null },
                { port: 25000, pid: null },
            ],
            Pools.DEFAULT,
            [],
        );

        expect(listing.ranges[0]?.ports).toEqual([{ name: "docs", port: 21002, pids: [null] }]);
        expect(listing.orphans).toEqual([{ port: 25000, pid: null }]);
        expect(RangeListing.render(listing, Pools.DEFAULT, undefined, "win32")).toBe(
            [
                "C:\\dev\\tool  21002-21002",
                "  docs  21002  pid ?",
                "",
                "orphans (in a pool, outside every range)",
                "  25000  pid ?",
                "",
            ].join("\n"),
        );
    });

    it("reports listeners in every pool outside every range as orphans and ignores listeners outside every pool", () => {
        const listing = RangeListing.collect(
            [APP],
            [
                { port: 2999, pid: 10 },
                { port: 3000, pid: 11 },
                { port: 3999, pid: 12 },
                { port: 4000, pid: 13 },
                { port: 21000, pid: 20 },
                { port: 21002, pid: 30 },
                { port: 25000, pid: 40 },
            ],
            [
                { start: 3000, end: 3999 },
                { start: 21000, end: 21002 },
            ],
            [],
        );

        expect(listing.orphans).toEqual([
            { port: 3000, pid: 11 },
            { port: 3999, pid: 12 },
            { port: 21002, pid: 30 },
        ]);
    });

    it("lists a range outside every pool with its listeners, which are not orphans", () => {
        const outside: RangeEntry = { folder: "C:\\dev\\outside", start: 3000, end: 3001, ports: { web: 3000, api: 3001 } };

        const listing = RangeListing.collect([outside], [{ port: 3001, pid: 70 }], Pools.DEFAULT, []);

        expect(listing).toEqual({
            ranges: [
                {
                    folder: "C:\\dev\\outside",
                    start: 3000,
                    end: 3001,
                    ports: [
                        { name: "web", port: 3000, pids: [] },
                        { name: "api", port: 3001, pids: [70] },
                    ],
                },
            ],
            orphans: [],
            commands: {},
        });
    });
});

describe("RangeListing.render", () => {
    it("prints a range whose ports are unreadable as its folder and span only", () => {
        const listing = RangeListing.collect([{ folder: "C:\\dev\\newer", start: 21010, end: 21011, ports: {} }], [], Pools.DEFAULT, []);

        expect(RangeListing.render(listing, Pools.DEFAULT, undefined, "win32")).toBe("C:\\dev\\newer  21010-21011\n");
    });

    it("prints each range as a table of names, ports and pids, then the orphans", () => {
        const listing = RangeListing.collect(
            [APP, TOOL],
            [
                { port: 21001, pid: 40 },
                { port: 25000, pid: 50 },
            ],
            Pools.DEFAULT,
            [],
        );

        expect(RangeListing.render(listing, Pools.DEFAULT, undefined, "win32")).toBe(
            [
                "C:\\dev\\app  21000-21001",
                "  web     21000  -",
                "  server  21001  pid 40",
                "",
                "C:\\dev\\tool  21002-21002",
                "  docs  21002  -",
                "",
                "orphans (in a pool, outside every range)",
                "  25000  pid 50",
                "",
            ].join("\n"),
        );
    });

    it("says so, naming every pool, when there is nothing to list", () => {
        const pools: Pool[] = [
            { start: 3000, end: 3999 },
            { start: 21000, end: 29999 },
        ];

        expect(RangeListing.render(RangeListing.collect([], [{ port: 4000, pid: 10 }], pools, []), pools, undefined, "win32")).toBe(
            "leeway: no ranges are registered and nothing is listening in 3000-3999, 21000-29999\n",
        );
    });

    it("prints the short command beside each pid that has a process row and marks this folder's range", () => {
        const listing = RangeListing.collect(
            [APP, TOOL],
            [
                { port: 21000, pid: 40 },
                { port: 21001, pid: 41 },
                { port: 25000, pid: 50 },
            ],
            Pools.DEFAULT,
            [
                { pid: 40, parent: 1, commandLine: '"C:\\Program Files\\nodejs\\node.exe" C:\\dev\\app\\node_modules\\vite\\bin\\vite.js' },
                { pid: 50, parent: 1, commandLine: "/usr/bin/node server.js --watch" },
                { pid: 60, parent: 1, commandLine: "/usr/bin/node unrelated.js" },
            ],
        );

        expect(RangeListing.render(listing, Pools.DEFAULT, "c:\\DEV\\app\\", "win32")).toBe(
            [
                "C:\\dev\\app  21000-21001  (this folder)",
                "  web     21000  pid 40  node.exe vite.js",
                "  server  21001  pid 41",
                "",
                "C:\\dev\\tool  21002-21002",
                "  docs  21002  -",
                "",
                "orphans (in a pool, outside every range)",
                "  25000  pid 50  node server.js --watch",
                "",
            ].join("\n"),
        );
    });

    it("prints each of several pids on a port on its own line, with its command", () => {
        const listing = RangeListing.collect(
            [TOOL],
            [
                { port: 21002, pid: 60 },
                { port: 21002, pid: 61 },
            ],
            Pools.DEFAULT,
            [
                { pid: 60, parent: 1, commandLine: "node a.js" },
                { pid: 61, parent: 1, commandLine: "node b.js" },
            ],
        );

        expect(RangeListing.render(listing, Pools.DEFAULT, undefined, "linux")).toBe(
            ["C:\\dev\\tool  21002-21002", "  docs  21002  pid 60  node a.js", "               pid 61  node b.js", ""].join("\n"),
        );
    });
});

describe("RangeListing.collect commands", () => {
    it("maps each listed pid to its full command line, skipping unlisted pids and empty command lines", () => {
        const listing = RangeListing.collect(
            [APP],
            [
                { port: 21000, pid: 40 },
                { port: 21001, pid: 4 },
                { port: 25000, pid: 50 },
                { port: 4000, pid: 70 },
            ],
            Pools.DEFAULT,
            [
                { pid: 4, parent: 0, commandLine: "" },
                { pid: 40, parent: 1, commandLine: "/usr/bin/node /home/me/app/vite.js" },
                { pid: 50, parent: 1, commandLine: "node server.js" },
                { pid: 70, parent: 1, commandLine: "node outside.js" },
            ],
        );

        expect(listing.commands).toEqual({ "40": "/usr/bin/node /home/me/app/vite.js", "50": "node server.js" });
    });
});

describe("RangeListing.shortCommand", () => {
    it("keeps a quoted Windows path, spaces and all, as one token cut to its last segment", () => {
        expect(RangeListing.shortCommand('"C:\\Program Files\\nodejs\\node.exe" --watch "C:\\my app\\server.js"')).toBe(
            "node.exe --watch server.js",
        );
    });

    it("cuts every POSIX path to its last segment", () => {
        expect(RangeListing.shortCommand("/usr/local/bin/node   ./node_modules/.bin/vite --port 21000")).toBe("node vite --port 21000");
    });

    it("cuts a short command longer than 60 characters to 60 with an ellipsis", () => {
        const shortened = RangeListing.shortCommand(`node ${"x".repeat(80)}`);

        expect(shortened).toBe(`node ${"x".repeat(54)}…`);
        expect(shortened).toHaveLength(60);
    });
});
