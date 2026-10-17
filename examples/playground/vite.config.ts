import { leeway } from "leeway/vite";
import { defineConfig } from "vite";
import config from "./leeway.json" with { type: "json" };

export default defineConfig({
    plugins: [leeway({ config, port: "PORT_WEB", preview: "PORT_WEB" })],
});
