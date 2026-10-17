import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class LeewayCli {
    static readonly catalogue = { PORT_WEB: { port: 5173 }, PORT_API: { port: 3001 } };

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

    static project(): { dir: string; home: string } {
        const dir = LeewayCli.temporaryDir("leeway-project-");
        const home = LeewayCli.temporaryDir("leeway-home-");

        fs.writeFileSync(path.join(dir, "leeway.json"), JSON.stringify(LeewayCli.catalogue));

        return { dir, home };
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

    private static readonly cliPath = path.join(import.meta.dirname, "..", "src", "cli.ts");

    private static readonly inheritedToStrip = [
        "CLAUDECODE",
        "GEMINI_CLI",
        "CURSOR_AGENT",
        "AI_AGENT",
        "VITEST",
        ...Object.keys(LeewayCli.catalogue),
    ];

    private static readonly temporaryDirs: string[] = [];

    private static env(home: string, extraEnv: Record<string, string>): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv };

        LeewayCli.inheritedToStrip.filter(name => !(name in extraEnv)).forEach(name => delete env[name]);

        return env;
    }
}
