import { defineConfig } from "tsdown";

export default defineConfig([
    {
        entry: { index: "src/index.ts" },
        platform: "neutral",
        fixedExtension: true,
        dts: true,
        exports: true,
    },
    {
        entry: { vite: "src/vite.ts", cli: "src/cli.ts" },
        platform: "node",
        dts: true,
        exports: {
            exclude: ["cli"],
            customExports: { "./schema.json": "./schema.json" },
        },
        deps: { neverBundle: ["vite"] },
    },
]);
