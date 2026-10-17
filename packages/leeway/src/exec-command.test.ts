import { describe, expect, it } from "vitest";
import { ExecCommand } from "./exec-command.ts";

describe("ExecCommand.requestOf", () => {
    it("claims without a flag, with or without --", () => {
        expect(ExecCommand.requestOf(["vite", "--port", "{{PORT_WEB}}"])).toEqual({
            mode: "claim",
            command: ["vite", "--port", "{{PORT_WEB}}"],
        });
        expect(ExecCommand.requestOf(["--", "vite"])).toEqual({ mode: "claim", command: ["vite"] });
    });

    it("reads --default and --inherit as the mode, with or without --", () => {
        expect(ExecCommand.requestOf(["--default", "vite"])).toEqual({ mode: "default", command: ["vite"] });
        expect(ExecCommand.requestOf(["--default", "--", "vite"])).toEqual({ mode: "default", command: ["vite"] });
        expect(ExecCommand.requestOf(["--inherit", "vite"])).toEqual({ mode: "inherit", command: ["vite"] });
        expect(ExecCommand.requestOf(["--inherit", "--", "vite"])).toEqual({ mode: "inherit", command: ["vite"] });
    });

    it("leaves flags it does not know, and anything after --, to the command", () => {
        expect(ExecCommand.requestOf(["--watch", "vite"])).toEqual({ mode: "claim", command: ["--watch", "vite"] });
        expect(ExecCommand.requestOf(["--", "--default"])).toEqual({ mode: "claim", command: ["--default"] });
        expect(ExecCommand.requestOf(["--inherit", "--", "--default"])).toEqual({ mode: "inherit", command: ["--default"] });
        expect(ExecCommand.requestOf(["pnpm", "--default", "--inherit"])).toEqual({
            mode: "claim",
            command: ["pnpm", "--default", "--inherit"],
        });
    });

    it("has no request when both modes are given", () => {
        expect(ExecCommand.requestOf(["--default", "--inherit", "vite"])).toBeUndefined();
        expect(ExecCommand.requestOf(["--inherit", "--default", "--", "vite"])).toBeUndefined();
    });

    it("has no request when the command is missing", () => {
        expect(ExecCommand.requestOf([])).toBeUndefined();
        expect(ExecCommand.requestOf(["--"])).toBeUndefined();
        expect(ExecCommand.requestOf(["--default"])).toBeUndefined();
        expect(ExecCommand.requestOf(["--inherit", "--"])).toBeUndefined();
    });
});

describe("ExecCommand.commandLine", () => {
    it("joins the command and puts each port in place of its {{NAME}}, every time it appears", () => {
        expect(
            ExecCommand.commandLine(["vite", "--port", "{{PORT_WEB}}", "--proxy", "http://localhost:{{PORT_API}}/{{PORT_API}}"], {
                PORT_WEB: 21000,
                PORT_API: 21001,
            }),
        ).toBe("vite --port 21000 --proxy http://localhost:21001/21001");
    });

    it("leaves placeholders that are not in the catalogue alone", () => {
        expect(ExecCommand.commandLine(["echo", "{{PORT_OTHER}}", "{PORT_WEB}"], { PORT_WEB: 21000 })).toBe(
            "echo {{PORT_OTHER}} {PORT_WEB}",
        );
    });

    it("takes a single argument as a shell line, as it is apart from the ports", () => {
        expect(ExecCommand.commandLine(["pnpm build && PORT=$X vite --port '{{PORT_WEB}}'"], { PORT_WEB: 21000 }, "linux")).toBe(
            "pnpm build && PORT=$X vite --port '21000'",
        );
        expect(ExecCommand.commandLine(['pnpm build && vite --port "{{PORT_WEB}}"'], { PORT_WEB: 21000 }, "win32")).toBe(
            'pnpm build && vite --port "21000"',
        );
    });

    it("quotes each argument for sh unless it is only safe characters, after putting the ports in", () => {
        expect(
            ExecCommand.commandLine(
                [
                    "node",
                    "-e",
                    "require('node:http').createServer().listen({{PORT_WEB}})",
                    "a b",
                    "",
                    "$HOME",
                    "C:\\dir",
                    "--x={{PORT_WEB}}",
                ],
                { PORT_WEB: 21000 },
                "linux",
            ),
        ).toBe(`node -e 'require('\\''node:http'\\'').createServer().listen(21000)' 'a b' '' '$HOME' 'C:\\dir' --x=21000`);
    });

    it("quotes each argument for cmd with double quotes, escaping inner double quotes", () => {
        expect(
            ExecCommand.commandLine(
                [
                    "node",
                    "-e",
                    "require('node:http').createServer().listen({{PORT_WEB}})",
                    'say "hi"',
                    "",
                    "a&b",
                    "C:\\dir",
                    "--x={{PORT_WEB}}",
                ],
                { PORT_WEB: 21000 },
                "win32",
            ),
        ).toBe(`node -e "require('node:http').createServer().listen(21000)" "say \\"hi\\"" "" "a&b" "C:\\dir" --x=21000`);
    });
});
