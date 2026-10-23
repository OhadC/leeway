import { describe, expect, it } from "vitest";
import type { RangeEntry } from "./range-registry.ts";
import { RangeListing } from "./range-listing.ts";

const APP: RangeEntry = { folder: "C:\\dev\\app", start: 21000, end: 21001, ports: { web: 21000, server: 21001 } };

const TOOL: RangeEntry = { folder: "C:\\dev\\tool", start: 21002, end: 21002, ports: { docs: 21002 } };

describe("RangeListing.collect", () => {
    it("lists every range by start with the pid listening on each named port", () => {
        const listing = RangeListing.collect([TOOL, APP], [{ port: 21001, pid: 40 }]);

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
        );

        expect(listing.ranges[0]?.ports).toEqual([{ name: "docs", port: 21002, pids: [60, 61] }]);
        expect(RangeListing.render(listing)).toContain("  docs  21002  pid 60, 61\n");
    });

    it("reports pool listeners outside every range as orphans and ignores listeners outside the pool", () => {
        const listing = RangeListing.collect(
            [APP],
            [
                { port: 3000, pid: 10 },
                { port: 21000, pid: 20 },
                { port: 21002, pid: 30 },
                { port: 29999, pid: 31 },
                { port: 30000, pid: 32 },
            ],
        );

        expect(listing.orphans).toEqual([
            { port: 21002, pid: 30 },
            { port: 29999, pid: 31 },
        ]);
    });

    it("lists a range outside the pool with its listeners, which are not orphans", () => {
        const outside: RangeEntry = { folder: "C:\\dev\\outside", start: 3000, end: 3001, ports: { web: 3000, api: 3001 } };

        const listing = RangeListing.collect([outside], [{ port: 3001, pid: 70 }]);

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
        });
    });
});

describe("RangeListing.render", () => {
    it("prints a range whose ports are unreadable as its folder and span only", () => {
        const listing = RangeListing.collect([{ folder: "C:\\dev\\newer", start: 21010, end: 21011, ports: {} }], []);

        expect(RangeListing.render(listing)).toBe("C:\\dev\\newer  21010-21011\n");
    });

    it("prints each range as a table of names, ports and pids, then the orphans", () => {
        const listing = RangeListing.collect(
            [APP, TOOL],
            [
                { port: 21001, pid: 40 },
                { port: 25000, pid: 50 },
            ],
        );

        expect(RangeListing.render(listing)).toBe(
            [
                "C:\\dev\\app  21000-21001",
                "  web     21000  -",
                "  server  21001  pid 40",
                "",
                "C:\\dev\\tool  21002-21002",
                "  docs  21002  -",
                "",
                "orphans (in the pool, outside every range)",
                "  25000  pid 50",
                "",
            ].join("\n"),
        );
    });

    it("says so when there is nothing to list", () => {
        expect(RangeListing.render(RangeListing.collect([], [{ port: 3000, pid: 10 }]))).toBe(
            "leeway: no ranges are registered and nothing is listening in 21000-29999\n",
        );
    });
});
