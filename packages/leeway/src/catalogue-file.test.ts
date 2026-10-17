import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogueFile } from "./catalogue-file.ts";

const folders: string[] = [];

afterEach(() => {
    folders.splice(0).forEach(folder => fs.rmSync(folder, { recursive: true, force: true }));
});

describe("CatalogueFile.find", () => {
    it("finds the catalogue in a folder above the one it starts from", () => {
        const folder = tempFolder();
        const nested = path.join(folder, "projects", "app", "src");
        fs.mkdirSync(nested, { recursive: true });
        writeCatalogue(folder, { PORT_APP: { port: 3000, app: "App" } });

        expect(CatalogueFile.find(nested)).toEqual({ folder, catalogue: { PORT_APP: { port: 3000, app: "App" } } });
    });

    it("prefers the nearest catalogue", () => {
        const folder = tempFolder();
        const inner = path.join(folder, "inner");
        fs.mkdirSync(inner);
        writeCatalogue(folder, { OUTER: { port: 3001 } });
        writeCatalogue(inner, { INNER: { port: 3002 } });

        expect(CatalogueFile.find(inner)).toEqual({ folder: inner, catalogue: { INNER: { port: 3002 } } });
    });

    it("refuses, naming the starting folder, when no folder above it has a catalogue", () => {
        const folder = tempFolder();

        expect(() => CatalogueFile.find(folder)).toThrowError(`leeway: no leeway.json in ${folder} or any folder above it`);
    });

    it.each([
        ["an array", [{ port: 3000 }]],
        ["null", null],
        ["a number", 3000],
    ])("refuses a catalogue that is %s", (_, content) => {
        const folder = tempFolder();
        writeCatalogue(folder, content);

        expect(() => CatalogueFile.find(folder)).toThrowError(
            `leeway: ${path.join(folder, "leeway.json")} must be an object of { "NAME": { "port": <integer 1-65535> } }`,
        );
    });

    it.each([
        ["a bare port", 3000],
        ["no port", { app: "App" }],
        ["a string port", { port: "3000" }],
        ["a fractional port", { port: 3000.5 }],
        ["port 0", { port: 0 }],
        ["port 65536", { port: 65536 }],
    ])("refuses an entry with %s, naming it", (_, entry) => {
        const folder = tempFolder();
        writeCatalogue(folder, { PORT_OK: { port: 3000 }, PORT_BAD: entry });

        expect(() => CatalogueFile.find(folder)).toThrowError(
            `leeway: PORT_BAD in ${path.join(folder, "leeway.json")} needs a "port" that is an integer 1-65535`,
        );
    });

    it.each(["web-port", "1PORT", "PORT WEB", ""])("rejects %j, which is not an environment variable name", name => {
        const folder = tempFolder();
        writeCatalogue(folder, { [name]: { port: 3000 } });

        expect(() => CatalogueFile.find(folder)).toThrowError(
            `leeway: ${JSON.stringify(name)} in ${path.join(folder, "leeway.json")} is not an environment variable name (letters, digits, _; not starting with a digit)`,
        );
    });

    it("accepts the port range edges", () => {
        const folder = tempFolder();
        writeCatalogue(folder, { LOW: { port: 1 }, HIGH: { port: 65535 } });

        expect(CatalogueFile.find(folder).catalogue).toEqual({ LOW: { port: 1 }, HIGH: { port: 65535 } });
    });

    it("refuses a catalogue that is not JSON, naming the file", () => {
        const folder = tempFolder();
        fs.writeFileSync(path.join(folder, "leeway.json"), "{ PORT_APP: 3000 }");

        expect(() => CatalogueFile.find(folder)).toThrowError(`leeway: ${path.join(folder, "leeway.json")} is not valid JSON`);
    });
});

function tempFolder(): string {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "leeway-catalogue-"));
    folders.push(folder);

    return folder;
}

function writeCatalogue(folder: string, content: unknown): void {
    fs.writeFileSync(path.join(folder, "leeway.json"), JSON.stringify(content));
}
