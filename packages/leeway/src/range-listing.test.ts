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
                    { name: "web", port: 21000, pid: undefined },
                    { name: "server", port: 21001, pid: 40 },
                ],
            },
            { folder: "C:\\dev\\tool", start: 21002, end: 21002, ports: [{ name: "docs", port: 21002, pid: undefined }] },
        ]);
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
});

describe("RangeListing.render", () => {
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
