import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["package-test/**/*.test.ts"],
        testTimeout: 60_000,
    },
});
