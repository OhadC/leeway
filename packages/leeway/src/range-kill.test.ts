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
            entry: APP,
            targets: [
                { pid: 70, ports: [21000, 21002] },
                { pid: 60, ports: [21001] },
            ],
        });
    });

    it("refuses a folder without a living range", () => {
        expect(() => RangeKill.planOfFolder([APP], LISTENERS, "C:\\dev\\tool", "win32")).toThrow(
            "leeway: no range is registered for C:\\dev\\tool",
        );
    });
});

describe("RangeKill.planOfPort", () => {
    it("targets the whole range containing the port", () => {
        expect(RangeKill.planOfPort([APP, TOOL], LISTENERS, 21003)).toEqual({ entry: TOOL, targets: [{ pid: 80, ports: [21003] }] });
    });

    it("refuses a port outside every living range, even when something listens on it", () => {
        expect(() => RangeKill.planOfPort([APP, TOOL], [...LISTENERS, { port: 25000, pid: 90 }], 25000)).toThrow(
            "leeway: port 25000 is not in any living range; see `leeway list`",
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

    it("says so when nothing listens in the range", () => {
        expect(RangeKill.render(RangeKill.planOfPort([APP], [], 21000), new Map())).toBe(
            "leeway: nothing is listening in c:\\dev\\app  21000-21002\n",
        );
    });
});
