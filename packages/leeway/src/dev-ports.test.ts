import { afterEach, describe, expect, it, vi } from "vitest";
import { devPorts } from "./dev-ports.ts";

const config = { ports: { PORT_WEB: { port: 5173, app: "Web" }, PORT_API: { port: 4100 } } };

const guarded = { ...config, agentGuard: true };

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe("devPorts", () => {
    it("returns the default ports when the environment says nothing", () => {
        expect(devPorts(config, {})).toEqual({ PORT_WEB: 5173, PORT_API: 4100 });
    });

    it("takes each port from its environment variable when it is set", () => {
        expect(devPorts(config, { PORT_WEB: "21000" })).toEqual({ PORT_WEB: 21000, PORT_API: 4100 });
    });

    it("takes ports injected as numbers", () => {
        expect(devPorts(config, { PORT_API: 21001 }).PORT_API).toBe(21001);
    });

    it("falls back to the default port when the variable is empty or not a port number", () => {
        expect(devPorts(config, { PORT_WEB: "65535" }).PORT_WEB).toBe(65535);
        expect(devPorts(config, { PORT_WEB: "65536" }).PORT_WEB).toBe(5173);
        expect(devPorts(config, { PORT_WEB: "" }).PORT_WEB).toBe(5173);
        expect(devPorts(config, { PORT_WEB: "not-a-port" }).PORT_WEB).toBe(5173);
        expect(devPorts(config, { PORT_WEB: "-1" }).PORT_WEB).toBe(5173);
        expect(devPorts(config, { PORT_WEB: "0" }).PORT_WEB).toBe(5173);
        expect(devPorts(config, { PORT_WEB: "21000.5" }).PORT_WEB).toBe(5173);
    });
});

describe("devPorts agent guard", () => {
    const agentShellError = /`leeway <command>`.*`leeway env --export`/;

    it("is off unless the config turns it on", () => {
        expect(devPorts(config, { CLAUDECODE: "1" })).toEqual({ PORT_WEB: 5173, PORT_API: 4100 });
        expect(devPorts({ ...config, agentGuard: false }, { CLAUDECODE: "1" })).toEqual({ PORT_WEB: 5173, PORT_API: 4100 });
    });

    it.each(["CLAUDECODE", "GEMINI_CLI", "CURSOR_AGENT", "AI_AGENT"])(
        "when the config turns it on, refuses default ports to a %s shell that has no leeway ports",
        marker => {
            expect(() => devPorts(guarded, { [marker]: "1" })).toThrowError(agentShellError);
        },
    );

    it("lets an agent shell through once any catalogue variable is in its environment", () => {
        expect(devPorts(guarded, { CLAUDECODE: "1", PORT_API: "21001" })).toEqual({ PORT_WEB: 5173, PORT_API: 21001 });
    });

    it("lets a vitest run in an agent shell through, since vitest imports modules that read ports", () => {
        expect(devPorts(guarded, { CLAUDECODE: "1", VITEST: "true" }).PORT_WEB).toBe(5173);
    });
});

describe("devPorts default environment", () => {
    it("reads ports from process.env", () => {
        vi.stubEnv("PORT_WEB", "21000");

        expect(devPorts(config).PORT_WEB).toBe(21000);
    });

    it("reads ports the vite plugin injected", () => {
        vi.stubGlobal("__LEEWAY_ENV__", { PORT_API: 21001 });

        expect(devPorts(config)).toEqual({ PORT_WEB: 5173, PORT_API: 21001 });
    });

    it("lets process.env win over injected ports", () => {
        vi.stubGlobal("__LEEWAY_ENV__", { PORT_WEB: 21001 });
        vi.stubEnv("PORT_WEB", "21002");

        expect(devPorts(config).PORT_WEB).toBe(21002);
    });
});
