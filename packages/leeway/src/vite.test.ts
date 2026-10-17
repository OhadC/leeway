import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConfigEnv, Plugin, UserConfig } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leeway } from "./vite.ts";

const catalogue = { PORT_WEB: { port: 5173 }, PORT_API: { port: 3001 } };
const serve: ConfigEnv = { command: "serve", mode: "development" };
const build: ConfigEnv = { command: "build", mode: "production" };

const folders: string[] = [];

afterEach(() => {
    vi.unstubAllEnvs();
    folders.splice(0).forEach(folder => fs.rmSync(folder, { recursive: true, force: true }));
});

describe("leeway vite plugin", () => {
    it("serves on the catalogue's default port, strictly", () => {
        const config = configOf(leeway({ catalogue, port: "PORT_WEB" }), {}, serve);

        expect(config.server).toEqual({ port: 5173, strictPort: true });
    });

    it("serves on the port the environment sets", () => {
        vi.stubEnv("PORT_WEB", "24555");

        const config = configOf(leeway({ catalogue, port: "PORT_WEB" }), {}, serve);

        expect(config.server).toEqual({ port: 24555, strictPort: true });
    });

    it("previews on its own port, strictly, when asked", () => {
        const config = configOf(leeway({ catalogue, port: "PORT_WEB", preview: "PORT_API" }), {}, serve);

        expect(config.preview).toEqual({ port: 3001, strictPort: true });
    });

    it("leaves preview alone when no preview port is named", () => {
        const config = configOf(leeway({ catalogue, port: "PORT_WEB" }), {}, serve);

        expect(config.preview).toBeUndefined();
    });

    it("injects every resolved port into the served code", () => {
        vi.stubEnv("PORT_API", "24556");

        const config = configOf(leeway({ catalogue, port: "PORT_WEB" }), {}, serve);

        expect(config.define).toEqual({ __LEEWAY_ENV__: '{"PORT_WEB":5173,"PORT_API":24556}' });
    });

    it("keeps the ports out of a build", () => {
        const config = configOf(leeway({ catalogue, port: "PORT_WEB" }), {}, build);

        expect(config.define).toBeUndefined();
    });

    it("injects the ports into a build when always asked to", () => {
        const config = configOf(leeway({ catalogue, port: "PORT_WEB", alwaysInject: true }), {}, build);

        expect(config.define).toEqual({ __LEEWAY_ENV__: '{"PORT_WEB":5173,"PORT_API":3001}' });
    });

    it("finds the catalogue above vite's root when none is given", () => {
        const folder = tempFolder();
        const appRoot = path.join(folder, "apps", "web");
        fs.mkdirSync(appRoot, { recursive: true });
        fs.writeFileSync(path.join(folder, "leeway.json"), JSON.stringify({ PORT_DOCS: { port: 4400 } }));

        const config = configOf(leeway({ port: "PORT_DOCS" }), { root: appRoot }, serve);

        expect(config.server).toEqual({ port: 4400, strictPort: true });
        expect(config.define).toEqual({ __LEEWAY_ENV__: '{"PORT_DOCS":4400}' });
    });

    it.each([
        ["port", { port: "PORT_WBE" }],
        ["preview port", { port: "PORT_WEB", preview: "PORT_WBE" }],
    ])("refuses an unknown %s, naming it and the known ones", (_, names) => {
        const folder = tempFolder();
        fs.writeFileSync(path.join(folder, "leeway.json"), JSON.stringify(catalogue));

        expect(() => configOf(leeway(names), { root: folder }, serve)).toThrowError(
            "leeway: PORT_WBE is not in the catalogue (PORT_WEB, PORT_API)",
        );
    });
});

function configOf(plugin: Plugin, userConfig: UserConfig, env: ConfigEnv): UserConfig {
    const hook = plugin.config;
    const handler = typeof hook === "function" ? hook : hook?.handler;

    return handler?.call({} as never, userConfig, env) as UserConfig;
}

function tempFolder(): string {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "leeway-vite-"));
    folders.push(folder);

    return folder;
}
