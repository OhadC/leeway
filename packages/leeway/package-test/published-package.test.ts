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
const consumerDir = path.join(scratchDir, "consumer");
const homeDir = path.join(scratchDir, "home");
const catalogue = { ports: { PORT_WEB: { port: 5173 }, PORT_API: { port: 3001 } } };

const CONSUMER_FILES: Record<string, string> = {
    "leeway.json": JSON.stringify(catalogue),
    "print-port.mjs": "console.log(process.env.PORT_WEB);\n",
    "imports.mjs": `import { devPorts } from "leeway";
import { leeway } from "leeway/vite";
import schema from "leeway/schema.json" with { type: "json" };
const config = ${JSON.stringify(catalogue)};
console.log(JSON.stringify({ ports: devPorts(config, {}), plugin: leeway({ config, port: "PORT_WEB" }).name, schema: typeof schema }));
`,
    "browser-entry.js": `import { devPorts } from "leeway";
globalThis.ports = devPorts(${JSON.stringify(catalogue)});
`,
    "browser-build.mjs": `import { build } from "vite";
const warnings = [];
await build({
    configFile: false,
    logLevel: "silent",
    build: {
        write: false,
        rolldownOptions: {
            input: "browser-entry.js",
            onLog: (level, log) => level === "warn" && warnings.push(log.message),
        },
    },
});
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
    const tarball = fs.readdirSync(scratchDir).find(file => file.endsWith(".tgz"));

    fs.mkdirSync(consumerDir);
    fs.mkdirSync(homeDir);
    fs.writeFileSync(
        path.join(consumerDir, "package.json"),
        JSON.stringify({
            name: "leeway-consumer",
            private: true,
            type: "module",
            dependencies: {
                leeway: `file:${path.join(scratchDir, tarball!)}`,
                vite: packageJson.devDependencies.vite,
                typescript: workspaceJson.devDependencies.typescript,
                "@types/node": workspaceJson.devDependencies["@types/node"],
            },
        }),
    );
    Object.entries(CONSUMER_FILES).forEach(([name, source]) => fs.writeFileSync(path.join(consumerDir, name), source));
    stdoutOf("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], consumerDir);
}, 300_000);

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

describe("the installed leeway entries", () => {
    it("import leeway, leeway/vite and leeway/schema.json", () => {
        expect(JSON.parse(consumerStdout("node", ["imports.mjs"]))).toEqual({
            ports: { PORT_WEB: 5173, PORT_API: 3001 },
            plugin: "leeway",
            schema: "object",
        });
    });

    it("bundle leeway for the browser without a vite warning", () => {
        expect(consumerStdout("node", ["browser-build.mjs"])).toBe("");
    });

    it("typecheck a consumer against the published declarations", () => {
        expect(consumerStdout("npx", ["tsc", "-p", "tsconfig.json"])).toBe("");
    });
});

function leewayIn(args: string[]): string {
    return consumerStdout("npx", ["leeway", ...args]);
}

function consumerStdout(command: string, args: string[]): string {
    return stdoutOf(command, args, consumerDir, LeewayCli.env(homeDir, {}));
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
