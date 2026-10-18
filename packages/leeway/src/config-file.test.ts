import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigFile } from "./config-file.ts";

const folders: string[] = [];

afterEach(() => {
    folders.splice(0).forEach(folder => fs.rmSync(folder, { recursive: true, force: true }));
});

describe("ConfigFile.find", () => {
    it("finds the config in a folder above the one it starts from", () => {
        const folder = tempFolder();
        const nested = path.join(folder, "packages", "app", "src");
        fs.mkdirSync(nested, { recursive: true });
        writeConfig(folder, { ports: { PORT_APP: { port: 3000, app: "App" } } });

        expect(ConfigFile.find(nested)).toEqual({ folder, config: { ports: { PORT_APP: { port: 3000, app: "App" } } } });
    });

    it("prefers the nearest config", () => {
        const folder = tempFolder();
        const inner = path.join(folder, "inner");
        fs.mkdirSync(inner);
        writeConfig(folder, { ports: { OUTER: { port: 3001 } } });
        writeConfig(inner, { ports: { INNER: { port: 3002 } } });

        expect(ConfigFile.find(inner)).toEqual({ folder: inner, config: { ports: { INNER: { port: 3002 } } } });
    });

    it("reads the agent guard setting", () => {
        const folder = tempFolder();
        writeConfig(folder, { ports: { PORT_APP: { port: 3000 } }, agentGuard: true });

        expect(ConfigFile.find(folder).config.agentGuard).toBe(true);
    });

    it("refuses, naming the starting folder, when no folder above it has a config", () => {
        const folder = tempFolder();

        expect(() => ConfigFile.find(folder)).toThrowError(
            `leeway: no leeway.json in ${folder} or any folder above it; create one: { "ports": { "PORT_WEB": { "port": 5173 } } }`,
        );
    });

    it.each([
        ["an array", [{ port: 3000 }]],
        ["null", null],
        ["a number", 3000],
    ])("refuses a config that is %s", (_, content) => {
        const folder = tempFolder();
        writeConfig(folder, content);

        expect(() => ConfigFile.find(folder)).toThrowError(
            `leeway: ${path.join(folder, "leeway.json")} must be an object of { "ports": { "NAME": { "port": <integer 1-65535> } }, "agentGuard"?: <boolean> }`,
        );
    });

    it.each([
        ["no ports", {}],
        ["an empty catalogue", { ports: {} }],
        ["ports that are not an object", { ports: [{ port: 3000 }] }],
        ["the old flat shape", { PORT_APP: { port: 3000 } }],
    ])("refuses a config with %s", (_, content) => {
        const folder = tempFolder();
        writeConfig(folder, content);

        expect(() => ConfigFile.find(folder)).toThrowError(
            `leeway: ${path.join(folder, "leeway.json")} needs "ports": { "NAME": { "port": <integer 1-65535> } }`,
        );
    });

    it("refuses an unknown setting, naming it and the known ones", () => {
        const folder = tempFolder();
        writeConfig(folder, { ports: { PORT_APP: { port: 3000 } }, agentGaurd: true });

        expect(() => ConfigFile.find(folder)).toThrowError(
            `leeway: "agentGaurd" in ${path.join(folder, "leeway.json")} is not a setting (ports, agentGuard)`,
        );
    });

    it("refuses an agent guard setting that is not a boolean", () => {
        const folder = tempFolder();
        writeConfig(folder, { ports: { PORT_APP: { port: 3000 } }, agentGuard: "yes" });

        expect(() => ConfigFile.find(folder)).toThrowError(
            `leeway: "agentGuard" in ${path.join(folder, "leeway.json")} must be true or false`,
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
        writeConfig(folder, { ports: { PORT_OK: { port: 3000 }, PORT_BAD: entry } });

        expect(() => ConfigFile.find(folder)).toThrowError(
            `leeway: PORT_BAD in ${path.join(folder, "leeway.json")} needs a "port" that is an integer 1-65535`,
        );
    });

    it.each(["web-port", "1PORT", "PORT WEB", ""])("rejects %j, which is not an environment variable name", name => {
        const folder = tempFolder();
        writeConfig(folder, { ports: { [name]: { port: 3000 } } });

        expect(() => ConfigFile.find(folder)).toThrowError(
            `leeway: ${JSON.stringify(name)} in ${path.join(folder, "leeway.json")} is not an environment variable name (letters, digits, _; not starting with a digit)`,
        );
    });

    it("accepts the port range edges", () => {
        const folder = tempFolder();
        writeConfig(folder, { ports: { LOW: { port: 1 }, HIGH: { port: 65535 } } });

        expect(ConfigFile.find(folder).config.ports).toEqual({ LOW: { port: 1 }, HIGH: { port: 65535 } });
    });

    it("refuses a config that is not JSON, naming the file", () => {
        const folder = tempFolder();
        fs.writeFileSync(path.join(folder, "leeway.json"), "{ ports: {} }");

        expect(() => ConfigFile.find(folder)).toThrowError(`leeway: ${path.join(folder, "leeway.json")} is not valid JSON`);
    });
});

function tempFolder(): string {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "leeway-config-"));
    folders.push(folder);

    return folder;
}

function writeConfig(folder: string, content: unknown): void {
    fs.writeFileSync(path.join(folder, "leeway.json"), JSON.stringify(content));
}
