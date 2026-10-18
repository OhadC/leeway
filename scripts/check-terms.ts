import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ORDINARY_WORDS = new Set([
    "key",
    "state",
    "valid",
    "stale",
    "active",
    "token",
    "flag",
    "setting",
    "variable",
    "block",
    "repo",
    "worktree",
    "lockfile",
]);
const ALLOWED: Record<string, string[]> = {
    "GLOSSARY.md": ["*"],
    "scripts/check-terms.ts": ["*"],
    "packages/leeway/src/vite.ts": ["root"],
    "packages/leeway/src/vite.test.ts": ["root"],
};

const repoDir = path.resolve(import.meta.dirname, "..");
const glossary = fs.readFileSync(path.join(repoDir, "GLOSSARY.md"), "utf8");
const terms = new Set(
    [...glossary.matchAll(/^_Avoid_:(.*)$/gm)]
        .flatMap(([, list]) => list!.split(",").map(wordsOf))
        .filter(term => !ORDINARY_WORDS.has(term)),
);
const pattern = new RegExp(`(?<![a-z0-9])(${[...terms].join("|")})s?(?![a-z0-9])`, "g");

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.ts", "*.md"], {
    cwd: repoDir,
    encoding: "utf8",
})
    .split("\n")
    .filter(file => file && fs.existsSync(path.join(repoDir, file)));

for (const file of files) {
    const allowed = ALLOWED[file] ?? [];
    if (allowed.includes("*")) {
        continue;
    }
    fs.readFileSync(path.join(repoDir, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
            const prose = file.endsWith(".md") ? line.replace(/`[^`]*`/g, " ") : line;
            for (const [, term] of wordsOf(prose).matchAll(pattern)) {
                if (!allowed.includes(term!)) {
                    console.error(`${file}:${index + 1}: "${term}" is a GLOSSARY.md _Avoid_ term`);
                    process.exitCode = 1;
                }
            }
        });
}

function wordsOf(text: string): string {
    return text
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9 ]+/g, "_");
}
