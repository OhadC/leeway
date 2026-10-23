import { describe, expect, it } from "vitest";
import { RangeKill } from "./range-kill.ts";
import type { RangeEntry } from "./range-registry.ts";

const APP: RangeEntry = { folder: "c:\\dev\\app", start: 21000, end: 21002, ports: { web: 21000, api: 21001, docs: 21002 } };

const TOOL: RangeEntry = { folder: "c:\\dev\\tool", start: 21003, end: 21003, ports: { web: 21003 } };

const LISTENERS = [
    { port: 3000, pid: 5 },
    { port: 21000, pid: 70 },
    { port: 21001, pid: 60 },
    { port: 21002, pid: 70 },
    { port: 21003, pid: 80 },
];

describe("RangeKill.planOfFolder", () => {
    it("targets each distinct pid listening inside the folder's range with the ports it holds", () => {
        const plan = RangeKill.planOfFolder([TOOL, APP], LISTENERS, "C:\\Dev\\App", "win32");

        expect(plan).toEqual({
            scope: "c:\\dev\\app  21000-21002",
            names: APP.ports,
            targets: [
                { pid: 70, ports: [21000, 21002] },
                { pid: 60, ports: [21001] },
            ],
            withRuns: true,
        });
    });

    it("refuses a folder without a living range", () => {
        expect(() => RangeKill.planOfFolder([APP], LISTENERS, "C:\\dev\\tool", "win32")).toThrow(
            "leeway: no range is registered for C:\\dev\\tool",
        );
    });
});

describe("RangeKill.planOfPort", () => {
    it("targets the whole range containing the port, with the leeway runs above its listeners", () => {
        expect(RangeKill.planOfPort([APP, TOOL], LISTENERS, 21003)).toEqual({
            scope: "c:\\dev\\tool  21003-21003",
            names: TOOL.ports,
            targets: [{ pid: 80, ports: [21003] }],
            withRuns: true,
        });
    });

    it("targets only the listeners on an orphan port in the pool, without the leeway runs above them", () => {
        const listeners = [...LISTENERS, { port: 25000, pid: 90 }, { port: 25000, pid: 91 }, { port: 25001, pid: 92 }];

        expect(RangeKill.planOfPort([APP, TOOL], listeners, 25000)).toEqual({
            scope: "orphan port 25000",
            names: {},
            targets: [
                { pid: 90, ports: [25000] },
                { pid: 91, ports: [25000] },
            ],
            withRuns: false,
        });
    });

    it("targets the whole range containing the port when that range lies outside the pool", () => {
        const outside: RangeEntry = { folder: "c:\\dev\\outside", start: 3000, end: 3001, ports: { web: 3000, api: 3001 } };

        expect(RangeKill.planOfPort([APP, outside], LISTENERS, 3001)).toEqual({
            scope: "c:\\dev\\outside  3000-3001",
            names: outside.ports,
            targets: [{ pid: 5, ports: [3000] }],
            withRuns: true,
        });
    });

    it("refuses a port outside every range and outside the pool", () => {
        expect(() => RangeKill.planOfPort([APP], LISTENERS, 3000)).toThrow(
            "leeway: port 3000 is in no range and outside the pool 21000-29999; leeway only kills there",
        );
    });
});

describe("RangeKill.render", () => {
    it("reports each pid with its named ports as killed or with its failure", () => {
        const plan = RangeKill.planOfPort([APP], LISTENERS, 21000);

        expect(RangeKill.render(plan, new Map([[60, "access denied"]]))).toBe(
            [
                "leeway: c:\\dev\\app  21000-21002",
                "  pid 70  web 21000, docs 21002  killed",
                "  pid 60  api 21001  failed: access denied",
                "",
            ].join("\n"),
        );
    });

    it("reports an orphan port's pids without names", () => {
        expect(RangeKill.render(RangeKill.planOfPort([], [{ port: 25000, pid: 90 }], 25000), new Map())).toBe(
            ["leeway: orphan port 25000", "  pid 90  25000  killed", ""].join("\n"),
        );
    });

    it("says so when nothing listens on an orphan port", () => {
        expect(RangeKill.render(RangeKill.planOfPort([], [], 25000), new Map())).toBe(
            "leeway: nothing is listening in orphan port 25000\n",
        );
    });

    it("says so when nothing listens in the range", () => {
        expect(RangeKill.render(RangeKill.planOfPort([APP], [], 21000), new Map())).toBe(
            "leeway: nothing is listening in c:\\dev\\app  21000-21002\n",
        );
    });
});
