import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pools } from "../src/registry/pools.ts";
import { LeewayCli } from "../test/leeway-cli.ts";

const packageDir = path.resolve(import.meta.dirname, "..");
const packageJson = readJson(path.join(packageDir, "package.json"));
const workspaceJson = readJson(path.join(packageDir, "..", "..", "package.json"));
const scratchDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "leeway-package-")));
const homeDir = path.join(scratchDir, "home");
const catalogue = { ports: { PORT_WEB: { port: 5173 }, PORT_API: { port: 3001 } } };
const devVite: string = packageJson.devDependencies.vite;
const VITE_RANGES = [devVite, "^7"];
const consumerDirs = new Map(VITE_RANGES.map((vite, index) => [vite, path.join(scratchDir, `consumer-${index}`)]));

const CONSUMER_FILES: Record<string, string> = {
    "leeway.json": JSON.stringify(catalogue),
    "print-port.mjs": "console.log(process.env.PORT_WEB);\n",
    "imports.mjs": `import { devPorts } from "leeway";
import { leeway } from "leeway/vite";
import schema from "leeway/schema.json" with { type: "json" };
const config = ${JSON.stringify(catalogue)};
console.log(JSON.stringify({ ports: devPorts(config, {}), plugin: leeway({ config, port: "PORT_WEB" }).name, schema: typeof schema }));
`,
    "resolve-config.mjs": `import { resolveConfig } from "vite";
import { leeway } from "leeway/vite";
const config = ${JSON.stringify(catalogue)};
const resolved = await resolveConfig({ configFile: false, logLevel: "silent", plugins: [leeway({ config, port: "PORT_WEB" })] }, "serve");
console.log(JSON.stringify({
    server: { port: resolved.server.port, strictPort: resolved.server.strictPort },
    preview: { port: resolved.preview.port, strictPort: resolved.preview.strictPort },
    LEEWAY_ENV: resolved.define.LEEWAY_ENV,
}));
`,
    "index.html": `<script type="module" src="./browser-entry.js"></script>\n`,
    "browser-entry.js": `import { devPorts } from "leeway";
globalThis.ports = devPorts(${JSON.stringify(catalogue)});
`,
    "browser-build.mjs": `import { build, createLogger } from "vite";
const warnings = [];
const logger = createLogger("silent");
logger.warn = message => warnings.push(message);
logger.warnOnce = message => warnings.push(message);
await build({ configFile: false, logLevel: "silent", customLogger: logger, build: { write: false } });
if (warnings.length > 0) {
    console.error(warnings.join("\\n"));
    process.exit(1);
}
`,
    "consumer.ts": `import { devPorts, type LeewayCatalogue, type LeewayConfig, type LeewayEnv, type PortsOf } from "leeway";
import { leeway } from "leeway/vite";

const config = { ports: { PORT_WEB: { port: 5173 }, PORT_API: { port: 3001 } } } satisfies LeewayConfig;
const ports: PortsOf<typeof config> = devPorts(config);
const catalogue: LeewayCatalogue = config.ports;
const env: LeewayEnv = { PORT_WEB: "5173" };
const web: number = ports.PORT_WEB;

// @ts-expect-error PORT_DOCS is not in the catalogue
const docs: number = ports.PORT_DOCS;

leeway({ config, port: "PORT_WEB", preview: "PORT_API" });
// @ts-expect-error PORT_WBE is not in the catalogue
leeway({ config, port: "PORT_WBE" });

export { catalogue, docs, env, web };
`,
    "tsconfig.json": JSON.stringify({
        compilerOptions: {
            target: "ES2024",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            types: ["node"],
        },
        files: ["consumer.ts"],
    }),
};

beforeAll(() => {
    stdoutOf("npm", ["pack", "--pack-destination", scratchDir], packageDir);
    const tarball = path.join(
        scratchDir,
        fs.readdirSync(scratchDir).find(file => file.endsWith(".tgz"))!,
    );

    fs.mkdirSync(homeDir);
    consumerDirs.forEach((consumerDir, vite) => installConsumer(consumerDir, tarball, vite));
}, 600_000);

afterAll(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 10 });
});

describe("the installed leeway bin", () => {
    it("prints the package version for --version", () => {
        expect(leewayIn(["--version"]).trim()).toBe(packageJson.version);
    });

    it("prints the usage for --help", () => {
        expect(leewayIn(["--help"])).toMatch(/^usage: leeway /);
    });

    it("prints an export line in the pool for each port name for env --export", () => {
        const ports = LeewayCli.exportedPorts(leewayIn(["env", "--export"]));

        expect(Object.keys(ports)).toEqual(Object.keys(catalogue.ports));
        expect(Object.values(ports).filter(port => !Pools.holds(Pools.DEFAULT, port))).toEqual([]);
    });

    it("hands the claimed ports to <command>", () => {
        const claimed = LeewayCli.exportedPorts(leewayIn(["env", "--export"])).PORT_WEB;

        expect(leewayIn(["node", "print-port.mjs"]).trim()).toBe(String(claimed));
    });
});

describe.each(VITE_RANGES)("the installed leeway entries on vite %s", vite => {
    const inConsumer = (command: string, args: string[]) => consumerStdout(vite, command, args);

    it("import leeway, leeway/vite and leeway/schema.json", () => {
        expect(JSON.parse(inConsumer("node", ["imports.mjs"]))).toEqual({
            ports: { PORT_WEB: 5173, PORT_API: 3001 },
            plugin: "leeway",
            schema: "object",
        });
    });

    it("set the serve and preview ports, strict, and define LEEWAY_ENV in vite's resolved config", () => {
        expect(JSON.parse(inConsumer("node", ["resolve-config.mjs"]))).toEqual({
            server: { port: 5173, strictPort: true },
            preview: { port: 5173, strictPort: true },
            LEEWAY_ENV: JSON.stringify({ PORT_WEB: 5173, PORT_API: 3001 }),
        });
    });

    it("bundle leeway for the browser without a vite warning", () => {
        expect(inConsumer("node", ["browser-build.mjs"])).toBe("");
    });

    it("typecheck a consumer against the published declarations", () => {
        expect(inConsumer("npx", ["tsc", "-p", "tsconfig.json"])).toBe("");
    });
});

function installConsumer(consumerDir: string, tarball: string, vite: string) {
    fs.mkdirSync(consumerDir);
    fs.writeFileSync(
        path.join(consumerDir, "package.json"),
        JSON.stringify({
            name: "leeway-consumer",
            private: true,
            type: "module",
            dependencies: {
                leeway: `file:${tarball}`,
                vite,
                typescript: workspaceJson.devDependencies.typescript,
                "@types/node": workspaceJson.devDependencies["@types/node"],
            },
        }),
    );
    Object.entries(CONSUMER_FILES).forEach(([name, source]) => fs.writeFileSync(path.join(consumerDir, name), source));
    stdoutOf("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], consumerDir);
}

function leewayIn(args: string[]): string {
    return consumerStdout(devVite, "npx", ["leeway", ...args]);
}

function consumerStdout(vite: string, command: string, args: string[]): string {
    return stdoutOf(command, args, consumerDirs.get(vite)!, LeewayCli.env(homeDir, {}));
}

function stdoutOf(command: string, args: string[], cwd: string, env = process.env): string {
    const commandLine = [command, ...args].map(arg => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ");
    const result = spawnSync(commandLine, { cwd, env, encoding: "utf8", shell: true });

    expect(result.status, `${commandLine}\n${result.stdout}${result.stderr}`).toBe(0);

    return result.stdout;
}

function readJson(file: string) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}
