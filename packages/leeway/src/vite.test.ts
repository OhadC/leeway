import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { build, createServer, type InlineConfig, preview, type Rolldown, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LeewayConfig } from "./dev-ports.ts";
import { leeway } from "./vite.ts";

const DEV_PORTS_PATH = path.join(import.meta.dirname, "dev-ports.ts");

const folders: string[] = [];

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(closers.splice(0).map(close => close()));
    folders.splice(0).forEach(folder => fs.rmSync(folder, { recursive: true, force: true }));
});

describe("leeway vite plugin in a dev server", () => {
    it("listens on the catalogue's port for the chosen port name", async () => {
        const port = await freePoolPort();

        const server = await listening({ plugins: [leeway({ config: catalogue({ PORT_WEB: port }), port: "PORT_WEB" })] });

        expect(listeningPortOf(server)).toBe(port);
    });

    it("listens on the port the environment sets for the chosen port name", async () => {
        const port = await freePoolPort();
        vi.stubEnv("PORT_WEB", String(port));

        const server = await listening({ plugins: [leeway({ config: catalogue({ PORT_WEB: 5173 }), port: "PORT_WEB" })] });

        expect(listeningPortOf(server)).toBe(port);
    });

    it("fails instead of moving to another port when the port is taken", async () => {
        const port = await freePoolPort();
        await occupied(port);

        const server = await createServer(
            inlineConfig({ server: { host: "127.0.0.1" }, plugins: [leeway({ config: catalogue({ PORT_WEB: port }), port: "PORT_WEB" })] }),
        );
        closers.push(() => server.close());

        await expect(server.listen()).rejects.toThrowError(String(port));
    });

    it("hands every resolved port to devPorts in the served code", async () => {
        const web = await freePoolPort();
        const api = 24556;
        vi.stubEnv("PORT_API", String(api));
        const config = catalogue({ PORT_WEB: web, PORT_API: 3001 });

        const server = await listening({ plugins: [leeway({ config, port: "PORT_WEB" })] });

        expect(await servedPorts(server, config)).toEqual({ PORT_WEB: web, PORT_API: api });
    });

    it("finds the config above vite's root when none is given", async () => {
        const port = await freePoolPort();
        const folder = tempFolder();
        const appRoot = path.join(folder, "apps", "web");
        fs.mkdirSync(appRoot, { recursive: true });
        fs.writeFileSync(path.join(folder, "leeway.json"), JSON.stringify(catalogue({ PORT_DOCS: port })));

        const server = await listening({ root: appRoot, plugins: [leeway({ port: "PORT_DOCS" })] });

        expect(listeningPortOf(server)).toBe(port);
    });

    it.each([
        ["port", { port: "PORT_WBE" }],
        ["preview port", { port: "PORT_WEB", preview: "PORT_WBE" }],
    ])("refuses an unknown %s, naming it and the known ones", async (_, names) => {
        const folder = tempFolder();
        fs.writeFileSync(path.join(folder, "leeway.json"), JSON.stringify(catalogue({ PORT_WEB: 5173, PORT_API: 3001 })));

        await expect(createServer(inlineConfig({ root: folder, plugins: [leeway(names)] }))).rejects.toThrowError(
            "leeway: PORT_WBE is not in the catalogue (PORT_WEB, PORT_API)",
        );
    });
});

describe("leeway vite plugin in a preview server", () => {
    it("previews on its own port when asked", async () => {
        const [web, api] = [await freePoolPort(), await freePoolPort()];

        const server = await previewing({
            plugins: [leeway({ config: catalogue({ PORT_WEB: web, PORT_API: api }), port: "PORT_WEB", preview: "PORT_API" })],
        });

        expect(listeningPortOf(server)).toBe(api);
    });

    it("previews on the dev server's port when no preview port is named", async () => {
        const port = await freePoolPort();
        vi.stubEnv("PORT_WEB", String(port));

        const server = await previewing({ plugins: [leeway({ config: catalogue({ PORT_WEB: 5173 }), port: "PORT_WEB" })] });

        expect(listeningPortOf(server)).toBe(port);
    });

    it("fails instead of moving to another port when the preview port is taken", async () => {
        const port = await freePoolPort();
        await occupied(port);

        await expect(
            previewing({ preview: { host: "127.0.0.1" }, plugins: [leeway({ config: catalogue({ PORT_WEB: port }), port: "PORT_WEB" })] }),
        ).rejects.toThrowError(String(port));
    });
});

describe("leeway vite plugin in a build", () => {
    const config = catalogue({ PORT_WEB: 5173, PORT_API: 3001 });

    it("keeps the ports out of a build, so devPorts in it gets the catalogue's ports", async () => {
        vi.stubEnv("PORT_API", "24556");

        expect(await builtPorts(leeway({ config, port: "PORT_WEB" }), config)).toEqual({ PORT_WEB: 5173, PORT_API: 3001 });
    });

    it("hands the resolved ports to devPorts in a build when always asked to", async () => {
        vi.stubEnv("PORT_API", "24556");

        expect(await builtPorts(leeway({ config, port: "PORT_WEB", alwaysInject: true }), config)).toEqual({
            PORT_WEB: 5173,
            PORT_API: 24556,
        });
    });

    it("builds in an agent shell with the agent guard on", async () => {
        vi.stubEnv("CLAUDECODE", "1");
        vi.stubEnv("VITEST", "");
        const guarded = { ...config, agentGuard: true };

        expect(await builtPorts(leeway({ config: guarded, port: "PORT_WEB" }), guarded)).toEqual({ PORT_WEB: 5173, PORT_API: 3001 });
    });
});

function catalogue(ports: Record<string, number>): LeewayConfig {
    return { ports: Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, { port }])) };
}

function inlineConfig(config: InlineConfig): InlineConfig {
    return { configFile: false, logLevel: "silent", ...config, root: config.root ?? tempFolder() };
}

async function listening(config: InlineConfig): Promise<ViteDevServer> {
    const server = await createServer(inlineConfig(config));

    closers.push(() => server.close());

    return server.listen();
}

async function previewing(config: InlineConfig) {
    const resolved = inlineConfig(config);
    fs.mkdirSync(path.join(resolved.root!, "dist"));
    const server = await preview(resolved);

    closers.push(() => server.close());

    return server;
}

function listeningPortOf(server: { httpServer: unknown }): number | undefined {
    return ((server.httpServer as net.Server).address() as net.AddressInfo | null)?.port;
}

async function servedPorts(server: ViteDevServer, config: LeewayConfig): Promise<unknown> {
    const origin = `http://localhost:${listeningPortOf(server)}`;
    const root = server.config.root;
    fs.writeFileSync(path.join(root, "main.ts"), `export { devPorts } from ${JSON.stringify(DEV_PORTS_PATH)};\n`);
    const devPortsUrl = /from "([^"]+)"/.exec(await served(`${origin}/main.ts`))![1];
    const scripts = [await served(`${origin}/@vite/env`), (await served(`${origin}${devPortsUrl}`)).replace(/^export /gm, "")];

    return inBrowser([...scripts, `globalThis.ports = devPorts(${JSON.stringify(config)});`]);
}

async function served(url: string): Promise<string> {
    const response = await fetch(url);

    expect(response.status).toBe(200);

    return response.text();
}

async function builtPorts(plugin: ReturnType<typeof leeway>, config: LeewayConfig): Promise<unknown> {
    const root = tempFolder();
    const main = path.join(root, "main.ts");
    fs.writeFileSync(
        main,
        `import { devPorts } from ${JSON.stringify(DEV_PORTS_PATH)};\nglobalThis.ports = devPorts(${JSON.stringify(config)});\n`,
    );

    const output = (await build(
        inlineConfig({ root, plugins: [plugin], build: { write: false, rolldownOptions: { input: main } } }),
    )) as Rolldown.RolldownOutput;

    return inBrowser(output.output.flatMap(chunk => (chunk.type === "chunk" ? [chunk.code] : [])));
}

function inBrowser(scripts: string[]): unknown {
    const context = vm.createContext({});

    scripts.forEach(script => vm.runInContext(script, context));

    return JSON.parse(vm.runInContext("JSON.stringify(globalThis.ports)", context));
}

async function freePoolPort(): Promise<number> {
    for (;;) {
        const port = 21000 + Math.floor(Math.random() * 9000);

        if (await isFree(port)) {
            return port;
        }
    }
}

function isFree(port: number): Promise<boolean> {
    const server = net.createServer();

    return new Promise(resolve => {
        server.once("error", () => resolve(false));
        server.listen(port, () => server.close(() => resolve(true)));
    });
}

function occupied(port: number): Promise<void> {
    const server = net.createServer();

    closers.push(() => new Promise(resolve => server.close(() => resolve())));

    return new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
}

function tempFolder(): string {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "leeway-vite-"));
    folders.push(folder);

    return folder;
}
