import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogueFile } from "./catalogue-file.ts";

const roots: string[] = [];

afterEach(() => {
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

describe("CatalogueFile.find", () => {
    it("finds the catalogue in a folder above the one it starts from", () => {
        const root = tempFolder();
        const nested = path.join(root, "projects", "app", "src");
        fs.mkdirSync(nested, { recursive: true });
        writeCatalogue(root, { PORT_APP: { port: 3000, app: "App" } });

        expect(CatalogueFile.find(nested)).toEqual({ root, catalogue: { PORT_APP: { port: 3000, app: "App" } } });
    });

    it("prefers the nearest catalogue", () => {
        const root = tempFolder();
        const inner = path.join(root, "inner");
        fs.mkdirSync(inner);
        writeCatalogue(root, { OUTER: { port: 3001 } });
        writeCatalogue(inner, { INNER: { port: 3002 } });

        expect(CatalogueFile.find(inner)).toEqual({ root: inner, catalogue: { INNER: { port: 3002 } } });
    });

    it("refuses, naming the starting folder, when no folder above it has a catalogue", () => {
        const root = tempFolder();

        expect(() => CatalogueFile.find(root)).toThrowError(`leeway: no leeway.json in ${root} or any folder above it`);
    });

    it.each([
        ["an array", [{ port: 3000 }]],
        ["null", null],
        ["a number", 3000],
    ])("refuses a catalogue that is %s", (_, content) => {
        const root = tempFolder();
        writeCatalogue(root, content);

        expect(() => CatalogueFile.find(root)).toThrowError(
            `leeway: ${path.join(root, "leeway.json")} must be an object of { "NAME": { "port": <integer 1-65535> } }`,
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
        const root = tempFolder();
        writeCatalogue(root, { PORT_OK: { port: 3000 }, PORT_BAD: entry });

        expect(() => CatalogueFile.find(root)).toThrowError(
            `leeway: PORT_BAD in ${path.join(root, "leeway.json")} needs a "port" that is an integer 1-65535`,
        );
    });

    it.each(["web-port", "1PORT", "PORT WEB", ""])("rejects %j, which is not an environment variable name", name => {
        const root = tempFolder();
        writeCatalogue(root, { [name]: { port: 3000 } });

        expect(() => CatalogueFile.find(root)).toThrowError(
            `leeway: ${JSON.stringify(name)} in ${path.join(root, "leeway.json")} is not an environment variable name (letters, digits, _; not starting with a digit)`,
        );
    });

    it("accepts the port range edges", () => {
        const root = tempFolder();
        writeCatalogue(root, { LOW: { port: 1 }, HIGH: { port: 65535 } });

        expect(CatalogueFile.find(root).catalogue).toEqual({ LOW: { port: 1 }, HIGH: { port: 65535 } });
    });

    it("refuses a catalogue that is not JSON, naming the file", () => {
        const root = tempFolder();
        fs.writeFileSync(path.join(root, "leeway.json"), "{ PORT_APP: 3000 }");

        expect(() => CatalogueFile.find(root)).toThrowError(`leeway: ${path.join(root, "leeway.json")} is not valid JSON`);
    });
});

function tempFolder(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "leeway-catalogue-"));
    roots.push(root);

    return root;
}

function writeCatalogue(folder: string, content: unknown): void {
    fs.writeFileSync(path.join(folder, "leeway.json"), JSON.stringify(content));
}
