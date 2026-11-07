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

    it("accepts the edges of the port numbers", () => {
        expect(devPorts(config, { PORT_WEB: "1", PORT_API: "65535" })).toEqual({ PORT_WEB: 1, PORT_API: 65535 });
    });

    it("gives the default port when the variable is empty", () => {
        expect(devPorts(config, { PORT_WEB: "" }).PORT_WEB).toBe(5173);
    });

    it("throws on a non-numeric value, naming the port name and the value", () => {
        expect(() => devPorts(config, { PORT_API: "abc" })).toThrowError('leeway: PORT_API is "abc", not a port 1-65535');
    });

    it.each(["0", "-1", "65536", "70000", "21000.5", " "])("throws on %j, which is not a port 1-65535", value => {
        expect(() => devPorts(config, { PORT_WEB: value })).toThrowError(`leeway: PORT_WEB is "${value}", not a port 1-65535`);
    });

    it("throws on an injected number that is not a port", () => {
        expect(() => devPorts(config, { PORT_API: 70000 })).toThrowError('leeway: PORT_API is "70000", not a port 1-65535');
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
        vi.stubGlobal("LEEWAY_ENV", { PORT_API: 21001 });

        expect(devPorts(config)).toEqual({ PORT_WEB: 5173, PORT_API: 21001 });
    });

    it("throws on a malformed port injected through LEEWAY_ENV", () => {
        vi.stubGlobal("LEEWAY_ENV", { PORT_API: "abc" });

        expect(() => devPorts(config)).toThrowError('leeway: PORT_API is "abc", not a port 1-65535');
    });

    it("lets process.env win over injected ports", () => {
        vi.stubGlobal("LEEWAY_ENV", { PORT_WEB: 21001 });
        vi.stubEnv("PORT_WEB", "21002");

        expect(devPorts(config).PORT_WEB).toBe(21002);
    });
});
