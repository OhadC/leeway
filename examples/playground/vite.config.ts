import { leeway } from "leeway/vite";
import { defineConfig } from "vite";
import catalogue from "./leeway.json" with { type: "json" };

export default defineConfig({
    plugins: [leeway({ catalogue, port: "PORT_WEB", preview: "PORT_WEB" })],
});
