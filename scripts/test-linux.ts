import { spawnSync } from "node:child_process";
import path from "node:path";

const IMAGE = "leeway-linux-test";
const root = path.resolve(import.meta.dirname, "..");
const testArgs = process.argv.slice(2).join(" ");

const build = spawnSync("podman", ["build", "-q", "-t", IMAGE, "-f", path.join(root, "scripts", "linux-test.Containerfile"), root], {
    stdio: ["ignore", "ignore", "inherit"],
});

if (build.status !== 0) {
    process.exit(build.status ?? 1);
}

const run = spawnSync(
    "podman",
    [
        "run",
        "--rm",
        "-v",
        `${root}:/src:ro`,
        IMAGE,
        "sh",
        "-c",
        `tar -C /src --exclude=node_modules --exclude=.git --exclude=dist -cf - . | tar -xf - && pnpm install --frozen-lockfile >/dev/null && pnpm --filter leeway exec vitest --run ${testArgs}`,
    ],
    { stdio: "inherit" },
);

process.exit(run.status ?? 1);
