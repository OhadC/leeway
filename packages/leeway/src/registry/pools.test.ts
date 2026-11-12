import { describe, expect, it } from "vitest";
import { Pools } from "./pools.ts";

describe("Pools.holds", () => {
    it("tells whether a port is in any pool", () => {
        const pools = [
            { start: 3000, end: 3999 },
            { start: 21000, end: 29999 },
        ];

        expect([2999, 3000, 3999, 4000, 20999, 21000, 29999, 30000].map(port => Pools.holds(pools, port))).toEqual([
            false,
            true,
            true,
            false,
            false,
            true,
            true,
            false,
        ]);
    });
});

describe("Pools.problem", () => {
    it.each([
        [[{ start: 3999, end: 3000 }], "3999-3000 starts after it ends"],
        [[{ start: 0, end: 3999 }], "0-3999 is not a pool of ports 1-65535"],
        [[{ start: 65536, end: 3000 }], "65536-3000 is not a pool of ports 1-65535"],
        [["3000-3999"], '"3000-3999" is not a pool of ports 1-65535'],
    ])("names what is wrong with %j", (pools, problem) => {
        expect(Pools.problem(pools)).toBe(problem);
    });
});
