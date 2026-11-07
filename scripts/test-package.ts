import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoDir = path.resolve(import.meta.dirname, "..");
const packageDir = path.join(repoDir, "packages", "leeway");
const packageJson = readJson(path.join(packageDir, "package.json"));
const workspaceJson = readJson(path.join(repoDir, "package.json"));
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

const failures: string[] = [];

try {
    succeeded("npm", ["pack", "--pack-destination", scratchDir], packageDir);
    setUpConsumer();

    check("leeway --version prints the package version", () => {
        expectEqual(leewayIn(["--version"]).stdout.trim(), packageJson.version);
    });
    check("leeway --help prints the usage", () => {
        expectMatch(leewayIn(["--help"]).stdout, /^usage: leeway /);
    });
    check("leeway env --export prints an export line in the pool for each port name", () => {
        const lines = leewayIn(["env", "--export"]).stdout.trim().split(/\r?\n/);

        expectEqual(lines.map(line => /^export (\w+)=/.exec(line)?.[1]).join(","), Object.keys(catalogue.ports).join(","));
        lines.forEach(line => expectInPool(Number(line.split("=")[1])));
    });
    check("leeway <command> hands the claimed ports to the command", () => {
        const claimed = /PORT_WEB=(\d+)/.exec(leewayIn(["env", "--export"]).stdout)?.[1];

        expectEqual(leewayIn(["node", "print-port.mjs"]).stdout.trim(), claimed ?? "a claimed PORT_WEB");
    });
    check("leeway, leeway/vite and leeway/schema.json import", () => {
        expectEqual(
            inConsumer("node", ["imports.mjs"]).stdout.trim(),
            JSON.stringify({ ports: { PORT_WEB: 5173, PORT_API: 3001 }, plugin: "leeway", schema: "object" }),
        );
    });
    check("leeway bundles for the browser", () => {
        inConsumer("node", ["browser-build.mjs"]);
    });
    check("a consumer typechecks against the published declarations", () => {
        inConsumer("npx", ["tsc", "-p", "tsconfig.json"]);
    });
} catch (error) {
    failures.push((error as Error).message);
} finally {
    fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 10 });
}

if (failures.length > 0) {
    console.error(`\n${failures.length} package check(s) failed:\n${failures.map(failure => `- ${failure}`).join("\n")}`);
    process.exit(1);
}

function setUpConsumer(): void {
    const tarball = fs.readdirSync(scratchDir).find(file => file.endsWith(".tgz"));

    if (!tarball) {
        throw new Error(`pack left no tarball in ${scratchDir}`);
    }

    fs.mkdirSync(consumerDir);
    fs.mkdirSync(homeDir);
    fs.writeFileSync(
        path.join(consumerDir, "package.json"),
        JSON.stringify({
            name: "leeway-consumer",
            private: true,
            type: "module",
            dependencies: {
                leeway: `file:${path.join(scratchDir, tarball)}`,
                vite: packageJson.devDependencies.vite,
                typescript: workspaceJson.devDependencies.typescript,
                "@types/node": workspaceJson.devDependencies["@types/node"],
            },
        }),
    );
    Object.entries(CONSUMER_FILES).forEach(([name, source]) => fs.writeFileSync(path.join(consumerDir, name), source));
    succeeded("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], consumerDir);
}

function check(name: string, body: () => void): void {
    try {
        body();
        console.log(`ok    ${name}`);
    } catch (error) {
        console.log(`FAIL  ${name}`);
        failures.push(`${name}: ${(error as Error).message}`);
    }
}

function leewayIn(args: string[]) {
    return inConsumer("npx", ["leeway", ...args]);
}

function inConsumer(command: string, args: string[]) {
    return succeeded(command, args, consumerDir, { ...process.env, HOME: homeDir, USERPROFILE: homeDir });
}

function succeeded(command: string, args: string[], cwd: string, env = process.env) {
    const commandLine = [command, ...args].map(arg => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ");
    const result = spawnSync(commandLine, { cwd, env, encoding: "utf8", shell: true });

    if (result.status !== 0) {
        throw new Error(`${commandLine} exited ${result.status}\n${result.stdout}${result.stderr}`);
    }

    return result;
}

function expectEqual(actual: string, expected: string): void {
    if (actual !== expected) {
        throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function expectMatch(actual: string, pattern: RegExp): void {
    if (!pattern.test(actual)) {
        throw new Error(`expected output matching ${pattern}, got ${JSON.stringify(actual)}`);
    }
}

function expectInPool(port: number): void {
    if (!(port >= 21000 && port <= 29999)) {
        throw new Error(`expected a port in 21000-29999, got ${port}`);
    }
}

function readJson(file: string) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}
