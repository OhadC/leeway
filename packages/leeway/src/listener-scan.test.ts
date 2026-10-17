import net from "node:net";
import { describe, expect, it } from "vitest";
import { type CommandRunner, ListenerScan } from "./listener-scan.ts";
import { RangeRegistry } from "./range-registry.ts";

const WINDOWS_CSV = ['"LocalPort","OwningProcess"', '"21001","4321"', '"21000","1234"', ""].join("\r\n");

const LINUX_SS = [
    'LISTEN 0      511          0.0.0.0:21001      0.0.0.0:*    users:(("node",pid=4321,fd=20))',
    'LISTEN 0      4096   127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=600,fd=14))',
    'LISTEN 0      511             [::]:21001         [::]:*    users:(("node",pid=4321,fd=21))',
    'LISTEN 0      128                *:22               *:*    users:(("sshd",pid=900,fd=3),("sshd: user",pid=901,fd=3))',
    'LISTEN 0      128   [fe80::1%eth0]:8080          [::]:*    users:(("my (app), v2",pid=1234,fd=7))',
    "LISTEN 0      128        127.0.0.1:631        0.0.0.0:*",
    "",
].join("\n");

const MAC_LSOF = [
    "p4321",
    "f20",
    "n*:21001",
    "f21",
    "n[::]:21001",
    "p600",
    "f5",
    "n127.0.0.1:631",
    "f6",
    "n[::1]:631",
    "p1234",
    "f7",
    "n[fe80::1%en0]:8080",
    "",
].join("\n");

describe("ListenerScan.listeners", () => {
    it("reads windows listeners as port and pid, ordered by port", () => {
        expect(ListenerScan.listeners("win32", printed(WINDOWS_CSV))).toEqual([
            { port: 21000, pid: 1234 },
            { port: 21001, pid: 4321 },
        ]);
    });

    it("reports a pid listening on several addresses of the same port once", () => {
        const csv = ['"LocalPort","OwningProcess"', '"21000","1234"', '"21000","1234"', '"21000","777"'].join("\r\n");

        expect(ListenerScan.listeners("win32", printed(csv))).toEqual([
            { port: 21000, pid: 777 },
            { port: 21000, pid: 1234 },
        ]);
    });

    it("reads linux listeners from ss, for every user of a socket and every address form", () => {
        expect(ListenerScan.listeners("linux", printed(LINUX_SS))).toEqual([
            { port: 22, pid: 900 },
            { port: 22, pid: 901 },
            { port: 53, pid: 600 },
            { port: 8080, pid: 1234 },
            { port: 21001, pid: 4321 },
        ]);
    });

    it("reads mac listeners from lsof fields, attributing each address to the process above it", () => {
        expect(ListenerScan.listeners("darwin", printed(MAC_LSOF))).toEqual([
            { port: 631, pid: 600 },
            { port: 8080, pid: 1234 },
            { port: 21001, pid: 4321 },
        ]);
    });

    it("reads no listeners when lsof finds nothing and exits 1", () => {
        expect(ListenerScan.listeners("darwin", () => ({ status: 1, stdout: "", stderr: "" }))).toEqual([]);
    });

    it("says why a scan failed", () => {
        const failed = () => ({ status: 1, stdout: "", stderr: "Cannot open netlink socket: Permission denied\n" });

        expect(() => ListenerScan.listeners("linux", failed)).toThrow("leeway: ss failed: Cannot open netlink socket: Permission denied");
    });

    it("finds a real server this process listens with in the pool", async () => {
        const server = await listenInPool();

        try {
            const port = (server.address() as net.AddressInfo).port;

            expect(ListenerScan.listeners()).toContainEqual({ port, pid: process.pid });
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    }, 30_000);

    it("refuses platforms it cannot scan yet", () => {
        expect(() => ListenerScan.listeners("aix", printed(WINDOWS_CSV))).toThrow("leeway: listing listeners is not supported on aix yet");
    });
});

function printed(stdout: string): CommandRunner {
    return () => ({ status: 0, stdout, stderr: "" });
}

async function listenInPool(): Promise<net.Server> {
    for (let attempt = 0; ; attempt++) {
        const port = RangeRegistry.POOL_START + Math.floor(Math.random() * (RangeRegistry.POOL_END - RangeRegistry.POOL_START + 1));
        const server = net.createServer();

        try {
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(port, "127.0.0.1", resolve);
            });

            return server;
        } catch (error) {
            if (attempt >= 20) {
                throw error;
            }
        }
    }
}
