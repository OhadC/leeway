import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Pool } from "../src/pools.ts";
import { RangeRegistry } from "../src/range-registry.ts";

export class LeewayCli {
    static readonly config = { ports: { PORT_WEB: { port: 5173 }, PORT_API: { port: 3001 } } };

    static readonly cliPath = path.join(import.meta.dirname, "..", "src", "cli.ts");

    static run(args: string[], cwd: string, home: string, extraEnv: Record<string, string> = {}) {
        return spawnSync(process.execPath, [LeewayCli.cliPath, ...args], { cwd, env: LeewayCli.env(home, extraEnv), encoding: "utf8" });
    }

    static start(args: string[], cwd: string, home: string): ChildProcess {
        return spawn(process.execPath, [LeewayCli.cliPath, ...args], {
            cwd,
            env: LeewayCli.env(home, {}),
            stdio: ["ignore", "pipe", "pipe"],
        });
    }

    static startInOwnConsole(args: string[], cwd: string, home: string): number {
        const argumentList = [LeewayCli.cliPath, ...args].map(arg => `"${arg}"`).join(" ");
        const result = LeewayCli.powershell(
            `[void][Leeway.Console]::SetConsoleCtrlHandler([System.IntPtr]::Zero, $false)
(Start-Process -FilePath '${process.execPath}' -ArgumentList '${argumentList}' -WorkingDirectory '${cwd}' -WindowStyle Hidden -PassThru).Id`,
            LeewayCli.env(home, {}),
        );

        return Number(result.stdout.trim());
    }

    static pressCtrlC(consolePid: number): number | null {
        return LeewayCli.powershell(
            `[void][Leeway.Console]::FreeConsole()
if (-not [Leeway.Console]::AttachConsole(${consolePid})) { exit 2 }
[void][Leeway.Console]::SetConsoleCtrlHandler([System.IntPtr]::Zero, $true)
if (-not [Leeway.Console]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }`,
            process.env,
        ).status;
    }

    static folder(): { dir: string; home: string; pool: Pool } {
        const dir = LeewayCli.temporaryDir("leeway-folder-");
        const home = LeewayCli.temporaryDir("leeway-home-");
        const pool = LeewayCli.privatePool();

        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify(LeewayCli.config));
        fs.mkdirSync(path.dirname(RangeRegistry.defaultPath(home)));
        fs.writeFileSync(RangeRegistry.defaultPath(home), JSON.stringify({ version: 1, pools: [pool], folders: {} }));

        return { dir, home, pool };
    }

    static claimedFolders(home: string): string[] {
        return Object.keys(JSON.parse(fs.readFileSync(RangeRegistry.defaultPath(home), "utf8")).folders);
    }

    static temporaryDir(prefix: string): string {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

        LeewayCli.temporaryDirs.push(dir);

        return dir;
    }

    static removeTemporaryDirs(): void {
        LeewayCli.temporaryDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
    }

    static exportedPorts(stdout: string): Record<string, number> {
        return Object.fromEntries(
            stdout
                .trim()
                .split("\n")
                .map(line => line.replace("export ", "").split("="))
                .map(([name, port]) => [name, Number(port)]),
        );
    }

    static env(home: string, extraEnv: Record<string, string>): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv };

        LeewayCli.inheritedToStrip.filter(name => !(name in extraEnv)).forEach(name => delete env[name]);

        return env;
    }

    private static readonly inheritedToStrip = [
        "CLAUDECODE",
        "GEMINI_CLI",
        "CURSOR_AGENT",
        "AI_AGENT",
        "VITEST",
        "NODE_ENV",
        "LEEWAY_FOLDER",
        ...Object.keys(LeewayCli.config.ports),
    ];

    private static readonly temporaryDirs: string[] = [];

    private static readonly privatePoolsStart = 30000;

    private static readonly privatePoolWidth = 100;

    private static readonly lowestLinuxEphemeralPort = 32768;

    private static privatePool(): Pool {
        const poolCount = Math.floor((LeewayCli.lowestLinuxEphemeralPort - LeewayCli.privatePoolsStart) / LeewayCli.privatePoolWidth);
        const start = LeewayCli.privatePoolsStart + LeewayCli.privatePoolWidth * randomInt(poolCount);

        return { start, end: start + LeewayCli.privatePoolWidth - 1 };
    }

    private static readonly windowsConsole = `Add-Type -Name Console -Namespace Leeway -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(System.IntPtr handler, bool add);
[DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint processGroup);
'@
`;

    private static powershell(script: string, env: NodeJS.ProcessEnv) {
        const encoded = Buffer.from(LeewayCli.windowsConsole + script, "utf16le").toString("base64");

        return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { env, encoding: "utf8" });
    }
}
