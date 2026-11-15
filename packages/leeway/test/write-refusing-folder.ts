import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export class WriteRefusingFolder {
    static readonly unsupported = "this user writes to folders whose writes are denied, as the superuser does";

    static refuse(dir: string): boolean {
        if (process.platform === "win32") {
            WriteRefusingFolder.icacls(dir, "/deny", `${WriteRefusingFolder.everyone}:(W)`);
            WriteRefusingFolder.refused.push(() => WriteRefusingFolder.icacls(dir, "/remove:d", WriteRefusingFolder.everyone));
        } else {
            fs.chmodSync(dir, 0o555);
            WriteRefusingFolder.refused.push(() => fs.chmodSync(dir, 0o755));
        }

        return !WriteRefusingFolder.isWritable(dir);
    }

    static allowAgain(): void {
        WriteRefusingFolder.refused.splice(0).forEach(allow => allow());
    }

    private static readonly everyone = "*S-1-1-0";

    private static readonly refused: (() => void)[] = [];

    private static isWritable(dir: string): boolean {
        const probe = path.join(dir, "write-probe");

        try {
            fs.mkdirSync(probe);
            fs.rmdirSync(probe);

            return true;
        } catch {
            return false;
        }
    }

    private static icacls(dir: string, ...args: string[]): void {
        const result = spawnSync("icacls", [dir, ...args], { encoding: "utf8" });

        if (result.status !== 0) {
            throw new Error(`icacls ${args.join(" ")} failed: ${result.stdout}${result.stderr}`);
        }
    }
}
