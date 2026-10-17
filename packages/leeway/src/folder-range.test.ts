import { describe, expect, it } from "vitest";
import { FolderRange } from "./folder-range.ts";

const FOUND = { folder: "C:\\dev\\app", config: { ports: { PORT_WEB: { port: 5173 }, PORT_API: { port: 3001 } } } };

const HANDED_DOWN = { PORT_WEB: "24000", PORT_API: "24001" };

describe("FolderRange.inheritedPorts", () => {
    it("takes the ports a leeway call for the same folder handed down", () => {
        expect(FolderRange.inheritedPorts(FOUND, { ...HANDED_DOWN, LEEWAY_FOLDER: "c:\\Dev\\App" }, "win32")).toEqual({
            PORT_WEB: 24000,
            PORT_API: 24001,
        });
    });

    it("takes nothing without a leeway call above, or under one for another folder", () => {
        expect(FolderRange.inheritedPorts(FOUND, HANDED_DOWN, "win32")).toBeUndefined();
        expect(FolderRange.inheritedPorts(FOUND, { ...HANDED_DOWN, LEEWAY_FOLDER: "C:\\dev\\app-feature" }, "win32")).toBeUndefined();
        expect(FolderRange.inheritedPorts(FOUND, { ...HANDED_DOWN, LEEWAY_FOLDER: "C:\\Dev\\App" }, "linux")).toBeUndefined();
    });

    it("takes nothing when a port of the catalogue was not handed down", () => {
        expect(FolderRange.inheritedPorts(FOUND, { PORT_WEB: "24000", LEEWAY_FOLDER: "C:\\dev\\app" }, "win32")).toBeUndefined();
    });
});
